import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { applyOperations, equivalenceSchema, FIT_LABELS, meaningModelFragment, normalizeOntology, ONTOLOGY_KINDS, operationSchema, renderOntologyTree, validateOntology } from './alien-ontology.mjs';
import { digest, findTargetLeaks, ISOLATION, PROVENANCE, readSearch, RECORD_SCHEMA, requireProblem, SEARCH_NODE_TYPE, sortedScopes, storeRecords, targetTerms, understandingRootId } from './alien-search.mjs';
import { buildTask, CANDIDATE_LIMITS, mechanismLabel, POPULATION_STATES, SIGNATURE_AXES, storedTask, TASK_ROLES, verifyTaskRef, worldOperatorSchema } from './alien-tasks.mjs';
import { diagnoseSearch, mechanismCondition } from './alien-diagnose.mjs';

const RESOURCE_URI = 'life-sim://addon/alien';
export const ALIEN_PAPER_URI = 'life-sim://theory/ontology-of-the-alien';
const id = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'Use letters, digits, dot, underscore, colon or hyphen.');
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopes = z.array(id).min(1).max(64);
const prose = (max) => z.string().trim().min(1).max(max);
const share = z.number().min(0).max(1);
const isolation = z.enum(ISOLATION);
const ruleId = z.string().regex(/^R[1-9][0-9]?$/u, 'Rule ids are R1, R2, ...');
const modelRefKinds = { process: ['processes', 'process'], law: ['laws', 'law'], claim: ['initial_claims', 'claim'],
  referent: ['meaning_model.referents', 'referent'], event: ['meaning_model.events', 'event'], cut: ['meaning_model.normalized_cuts', null],
  concept: ['meaning_model.concepts', 'concept'], abstract_cut: ['meaning_model.abstract_cuts', 'abstract_cut'],
  event_relation: ['meaning_model.event_relations', 'event_relation'], binding: ['meaning_model.event_referent_bindings', 'event_referent_binding'],
  realization: ['meaning_model.realizations', 'realization'] };
const modelRef = z.string().max(1_024).regex(new RegExp(`^(${Object.keys(modelRefKinds).join('|')}):\\S+$`, 'u'), 'Use kind:id, for example process:<id> or referent:<id>.');
const sumsToOne = (values) => Math.abs(values.reduce((total, value) => total + value, 0) - 1) <= 1e-9;

export const alienInstructions = `The alien add-on runs world-diversity search from Ontology of the Alien inside Meaning Model. It builds invented worlds, solves the problem inside them, compiles the operative mechanisms back into the problem's domain, and curates what it finds in revisable ontologies that steer the next world.
Paper first: read ${ALIEN_PAPER_URI} in this MCP process before starting or continuing a search; the write tools refuse until it has been read.
Roles and what each may see. The server writes and stores every task with life_alien_task; the partition is in the task text itself:
- builder: a seed word and optional departures or a commission; never the problem
- solver: the recorded world, the problem statement and its constraints, but not the problem's context, why the world exists or what happens next
- compiler: world, solution and problem; it keeps the strangest element. Its population state is none (the paper's condition F), a Semantic Tabu archive (G) or the curated map (H)
- explorer: the problem with no world, optionally with a random-word cue, and population state none, tabu or map (conditions C, A, B, and with a cue C, D, E)
- curator: owns the mechanism ontology and the claimed-outcome ontology and decides admission
- world_curator: codes each world's causal signature and owns the regime ontology, still without the problem
- transfer: maps a mechanism's roles onto the bound target model
Run builder, solver and world_curator tasks in fresh contexts that see only the task, for example separate subagents. When you cannot, do the step yourself and record same_context honestly; target blindness is then procedural, not established.
Loop: life_alien_search_start (problem and target model) -> builder task -> record world with its taskNodeId -> solver task -> record solution -> world_curator task -> life_alien_ontology_revise (worlds) -> compiler task -> record mechanism -> curator tasks (mechanisms, outcomes) -> life_alien_ontology_revise -> life_alien_search_diagnose -> record a commission for the gap you judge most useful -> the next builder task takes commissionNodeId. Transfer the mechanisms you want to develop, record assessments, and record a selection when the user wants a single idea, a diverse portfolio or a weighted set. Read the whole search with life_alien_atlas.
Numbers follow the Meaning Model rule: a graded fit is a fit Cut with a question, unit and remainder; a weighted selection is an allocation with a remainder; ontology fit is categorical.
The server checks structure: stored task provenance, rule and role bindings, ontology references and acyclicity, the admission guard, model references, Cut sums, and target terms in target-blind tasks. It does not judge whether a world is coherent, whether two mechanisms are equivalent, or whether an idea works. Worlds are textual thought experiments, not simulations; a transfer records an idea and its mapping, not evidence. Develop an unusual branch before judging it on familiarity.`;

const searchStartSchema = z.object({
  requestId: id,
  modelHash: hash.nullable().default(null).describe('Target model for a new search graph. Build or register it first; transfers bind roles to its records.'),
  graphId: id.nullable().default(null).describe('Identifier of the new graph when modelHash is given.'),
  graphHash: hash.nullable().default(null).describe('Instead of modelHash: add the search to this existing graph, bound to its model.'),
  searchId: id.describe('Node ID of the search root.'),
  title: prose(200),
  problem: z.object({
    statement: prose(4_000), context: z.string().max(12_000).default(''), constraints: z.array(prose(1_000)).max(20).default([]),
    targetTerms: z.array(prose(120)).max(100).default([]).describe('Words or phrases that would disclose the target to a builder. Always checked.'),
    deriveTargetTerms: z.boolean().default(true).describe('Also derive content words from the statement. Context words are not derived; list them in targetTerms.'),
  }).strict(),
  authorId: id,
  accessScopes: scopes.describe('Author scope for the problem and every record of this search.'),
}).strict().superRefine((input, context) => {
  if ((input.modelHash === null) === (input.graphHash === null)) context.addIssue({ code: 'custom', path: ['modelHash'], message: 'Give exactly one of modelHash (new graph) or graphHash (existing graph).' });
  if (input.modelHash !== null && input.graphId === null) context.addIssue({ code: 'custom', path: ['graphId'], message: 'A new search graph needs graphId.' });
});

const taskSchema = z.object({
  graphHash: hash, requestId: id, nodeId: id.nullable().default(null).describe('Node ID for the stored task; defaults to task.<requestId>.'),
  searchRootId: id, authorId: id, accessScopes: scopes,
  role: z.enum(TASK_ROLES),
  inputs: z.object({
    slot: z.number().int().min(0).max(100_000).nullable().optional().describe('builder: draw slot; omit for the lowest slot neither held by a world nor reserved by a prepared builder task.'),
    seedWord: id.nullable().optional().describe('builder: a supplied seed; omit to draw from the bank.'),
    seedSalt: id.nullable().optional().describe('builder: draw again with this salt; the world records it.'),
    operators: z.array(worldOperatorSchema).max(6).optional().describe('builder: departures composed with the seed.'),
    commissionNodeId: id.nullable().optional().describe('builder (new_world), compiler (retry) or explorer commission.'),
    populationState: z.enum(POPULATION_STATES).optional().describe('compiler (default none) or explorer (default map): none, tabu or map.'),
    cueWord: id.nullable().optional().describe('explorer: a random-word cue to use.'), drawCue: z.boolean().optional().describe('explorer: draw a cue word from the bank.'),
    ontology: z.enum(['mechanisms', 'outcomes']).optional().describe('curator: which ontology the decision concerns (default mechanisms).'),
    worldNodeId: id.optional(), solutionNodeId: id.optional(), subjectNodeId: id.optional(), mechanismNodeId: id.optional(),
  }).strict().default({}),
}).strict();

const taskRefSchema = z.object({ role: z.enum(TASK_ROLES), graphHash: hash, inputs: z.record(z.string(), z.json()), taskHash: hash }).strict();
const candidateSchema = z.object(Object.fromEntries(Object.entries(CANDIDATE_LIMITS).map(([field, limit]) => [field, prose(limit)]))).strict();
// A graded fit is a Cut: one declared comparison unit divided among matches, does not match and an unresolved remainder.
const fitCutSchema = z.object({
  question: prose(400).describe('The comparison question, for example how the comparison budget of this role alignment divides.'),
  unit: prose(200).describe('The one divided unit, for example one comparison budget over the mechanism roles.'),
  matches: share, doesNotMatch: share, remainder: share,
}).strict().refine((cut) => sumsToOne([cut.matches, cut.doesNotMatch, cut.remainder]), 'A fit Cut divides one unit: matches, doesNotMatch and remainder sum to 1.');

const recordData = {
  world: z.object({
    title: prose(200), text: prose(64_000).describe('The builder output, verbatim.'), principle: prose(4_000),
    rules: z.array(z.object({ id: ruleId, statement: prose(2_000) }).strict()).min(1).max(12),
    society: z.string().max(8_000).default(''), easy: z.array(prose(1_000)).max(12).default([]), hard: z.array(prose(1_000)).max(12).default([]),
    isolation: z.object({ builder: isolation }).strict(),
  }).strict(),
  solution: z.object({
    worldNodeId: id, text: prose(64_000).describe('The solver output, verbatim.'), citedRuleIds: z.array(ruleId).max(24).default([]),
    isolation: z.object({ solver: isolation }).strict(),
  }).strict(),
  mechanism: z.object({
    operator: prose(600),
    roles: z.array(z.object({ id, description: prose(400), worldRuleIds: z.array(ruleId).max(12).default([]) }).strict()).min(2).max(8),
    magicalElements: z.array(z.object({ element: prose(400), fix: z.object({
      kind: z.enum(['invented_technology', 'existing_approximation', 'institutional_substitute', 'unresolved']), text: prose(1_000) }).strict() }).strict()).max(24).default([]),
    strangest: z.object({ element: prose(400), preserved: prose(1_000) }).strict(),
    candidate: candidateSchema,
    selfAudit: z.object({ bottleneckRelief: z.enum(['clear', 'partial', 'none']), fiat: z.enum(['pass', 'borderline', 'fail']),
      capabilityProvenance: z.enum(['direct', 'amplified', 'mixed']), rationale: prose(2_000) }).strict().nullable().default(null),
    isolation: z.object({ compiler: isolation }).strict(),
  }).strict(),
  commission: z.object({
    addressedTo: z.enum(['new_world', 'explorer']),
    relationToChange: prose(1_000).nullable().default(null), worldAsk: prose(1_000).nullable().default(null),
    operators: z.array(worldOperatorSchema).max(6).default([]), avoidConceptIds: z.array(id).max(32).default([]),
    rationale: prose(4_000), diagnosis: z.object({ graphHash: hash, diagnosisHash: hash }).strict().nullable().default(null),
  }).strict().superRefine((value, context) => {
    if (value.addressedTo === 'new_world' && value.worldAsk === null && !value.operators.length) context.addIssue({ code: 'custom', path: ['worldAsk'], message: 'A new-world commission needs a worldAsk or operators.' });
    if (value.addressedTo === 'explorer' && value.relationToChange === null) context.addIssue({ code: 'custom', path: ['relationToChange'], message: 'An explorer commission needs relationToChange.' });
    if (value.addressedTo === 'explorer' && (value.worldAsk !== null || value.operators.length)) context.addIssue({ code: 'custom', path: ['worldAsk'], message: 'worldAsk and operators belong to new-world commissions.' });
  }),
  transfer: z.object({
    mechanismNodeId: id,
    roleMap: z.array(z.object({ roleId: id, binding: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('model'), ref: modelRef, how: prose(1_000) }).strict(),
      z.object({ kind: z.literal('new_component'), description: prose(1_000) }).strict(),
      z.object({ kind: z.literal('unfilled'), reason: prose(1_000) }).strict(),
    ]) }).strict()).min(1).max(8),
    proxies: z.array(z.object({ element: prose(400), label: z.enum(['portable', 'inverse', 'magical']), proxy: prose(1_000),
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Date the judgment as YYYY-MM-DD.') }).strict()).max(24).default([]),
    disanalogies: z.array(prose(1_000)).min(1).max(12),
    candidate: candidateSchema,
    fitCut: fitCutSchema.nullable().default(null),
    evidenceNeeded: z.array(prose(1_000)).min(1).max(12),
  }).strict(),
  assessment: z.object({ subjectNodeIds: z.array(id).min(1).max(32), verdict: prose(120).nullable().default(null), text: prose(8_000) }).strict(),
  selection: z.object({
    format: z.enum(['single', 'portfolio', 'weighted']),
    items: z.array(z.object({ nodeId: id, weight: share.nullable().default(null), reason: prose(2_000) }).strict()).min(1).max(50),
    // A weighted selection is an allocation Cut: a declared question and unit, item shares and an explicit remainder.
    allocation: z.object({ question: prose(400), unit: prose(200), remainder: share }).strict().nullable().default(null),
    rationale: prose(4_000),
    preserved: z.array(z.object({ conceptId: id, reason: prose(1_000) }).strict()).max(32).default([]),
  }).strict().superRefine((value, context) => {
    if (value.format === 'single' && value.items.length !== 1) context.addIssue({ code: 'custom', path: ['items'], message: 'A single selection has exactly one item.' });
    const weights = value.items.map((item) => item.weight);
    if (value.format === 'weighted') {
      if (!value.allocation) context.addIssue({ code: 'custom', path: ['allocation'], message: 'A weighted selection is an allocation: give its question, unit and remainder.' });
      else if (weights.some((weight) => weight === null) || !sumsToOne([...weights, value.allocation.remainder])) {
        context.addIssue({ code: 'custom', path: ['items'], message: 'Every item carries a share, and the shares plus the remainder sum to 1. They divide the declared unit; they are not calibrated probabilities.' });
      }
    } else {
      if (weights.some((weight) => weight !== null) || value.allocation) context.addIssue({ code: 'custom', path: ['items'], message: 'Only weighted selections carry shares and an allocation.' });
    }
  }),
};
export const RECORD_KINDS = Object.freeze(Object.keys(recordData));

const recordSchema = z.object({
  graphHash: hash, requestId: id, nodeId: id, searchRootId: id, authorId: id, accessScopes: scopes,
  kind: z.enum(RECORD_KINDS),
  taskNodeId: id.nullable().default(null).describe('The stored task this output answers. Required for world (builder), solution (solver) and mechanism (compiler or explorer); optional for transfer.'),
  taskRef: taskRefSchema.nullable().default(null).describe('Earlier form of task provenance, verified by recomputation; use taskNodeId.'),
  data: z.json().describe('Kind-specific fields; see the add-on guide.'),
  note: z.string().trim().max(4_000).nullable().default(null),
}).strict();

const reviseSchema = z.object({
  graphHash: hash, requestId: id, nodeId: id, searchRootId: id, authorId: id, accessScopes: scopes,
  ontology: z.enum(ONTOLOGY_KINDS),
  expectedHeadNodeId: id.nullable().describe('The current head revision of this ontology, or null for the first revision.'),
  decision: z.object({
    verdict: z.enum(['admit_new', 'admit_instance', 'equivalent', 'reject_redirect', 'restructure_only']),
    subjectNodeId: id.nullable().default(null), conceptId: id.nullable().default(null), nearestConceptId: id.nullable().default(null),
    equivalence: equivalenceSchema.nullable().default(null),
    fit: z.enum(FIT_LABELS).nullable().default(null).describe('Categorical fit of the subject to its concept, or null.'),
    signature: z.object(Object.fromEntries(SIGNATURE_AXES.map((axis) => [axis, z.object({
      code: z.string().trim().min(1).max(80).describe('A short code that later worlds reuse when they agree on this axis.'),
      note: z.string().trim().min(1).max(600).nullable().default(null) }).strict().nullable()]))).strict().nullable().default(null),
    redirect: z.object({ addressedTo: z.enum(['retry', 'new_world']), relationToChange: prose(1_000), alternatives: z.array(prose(400)).max(8).default([]),
      worldAsk: prose(1_000).nullable().default(null), commissionNodeId: id }).strict().nullable().default(null),
    rationale: prose(4_000),
  }).strict(),
  operations: z.array(operationSchema).max(200).default([]),
  taskNodeId: id.nullable().default(null),
  taskRef: taskRefSchema.nullable().default(null),
  isolation: z.object({ curator: isolation }).strict().default({ curator: 'same_context' }),
}).strict();

const readSchema = z.object({ graphHash: hash, searchRootId: id, accessScopes: scopes }).strict();
const atlasSchema = readSchema.extend({ includeWorldTexts: z.boolean().default(false) }).strict();

function resolveModelRef(model, ref) {
  const split = ref.indexOf(':'); const kind = ref.slice(0, split); const recordId = ref.slice(split + 1);
  const [path, anchorKind] = modelRefKinds[kind];
  let records = model;
  for (const key of path.split('.')) records = records?.[key];
  if (!Array.isArray(records) || !records.some((record) => record?.id === recordId)) throw new Error(`Transfer ref ${ref} does not name a ${kind} in the target model.`);
  return { kind, recordId, anchorKind };
}

export class AlienAddon {
  constructor(service) { this.service = service; }

  async startSearch(raw) {
    const input = searchStartSchema.parse(raw);
    const accessScopes = sortedScopes(input.accessScopes);
    let view = null; let modelHash = input.modelHash;
    if (input.graphHash) {
      view = await this.service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: false, accessScopes });
      modelHash = view.graph.source_snapshot?.model_hash;
      if (typeof modelHash !== 'string') throw new Error('The existing graph must be bound to a registered target model.');
    }
    const { model } = await this.service.inspectModel({ modelHash, includeDefinition: true });
    const uroot = understandingRootId(input.searchId);
    const problemNodeId = `${input.searchId}.problem`;
    const ids = [input.searchId, uroot, problemNodeId];
    if (view) for (const nodeId of ids) if (view.nodes.some((node) => node.id === nodeId)) throw new Error(`Node ${nodeId} already exists in this graph; choose another searchId.`);
    const provenance = [PROVENANCE, `author:${input.authorId}`, 'Search clock: search_step, not world time.'];
    const step = view ? view.graph.revision.number : 0;
    const terms = targetTerms(input.problem);
    const common = { authority: { source: input.authorId, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: accessScopes, training: 'exclude', provenance };
    const nodes = [
      { ...common, id: input.searchId, node_type: SEARCH_NODE_TYPE, role: 'document_root', title: input.title, text: `# ${input.title}`,
        render: 'include', epistemic_status: 'ideation_search', evidence_type: 'creative_hypothesis' },
      { ...common, id: uroot, node_type: 'understanding_process_root', role: 'metadata', title: `Search understanding for ${input.searchId}`, subject: input.searchId,
        text: JSON.stringify({ name: `Search understanding for ${input.searchId}`, clock: 'search_step',
          purpose: 'Tasks, worlds, solves, compiled mechanisms, ontology revisions, commissions and transfers of this search.' }),
        render: 'exclude', epistemic_status: 'authored_process', evidence_type: 'creative_hypothesis' },
      { ...common, id: problemNodeId, node_type: 'alien.problem', role: 'metadata', title: 'Problem', subject: input.searchId, holder: input.authorId, value_time: step,
        text: JSON.stringify({ schema: RECORD_SCHEMA, kind: 'problem', data: { ...input.problem, derivedTerms: terms },
          searchClock: { rootId: uroot, unit: 'search_step', at: step, index: 0 } }),
        render: 'exclude', epistemic_status: 'authored_brief', evidence_type: 'creative_hypothesis' },
    ];
    const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
    const edges = [
      { id: `${input.searchId}.targets`, source: endpoint(input.searchId), target: { kind: 'anchor', anchor_kind: 'model', anchor_id: model.id },
        family: 'grounding', relation: 'targets', access_scopes: accessScopes, provenance },
      { id: `${uroot}.search`, source: endpoint(uroot), target: endpoint(input.searchId), family: 'semantic', relation: 'about', access_scopes: accessScopes, provenance },
      { id: `${problemNodeId}.placement`, source: endpoint(uroot), target: endpoint(problemNodeId), family: 'structural', relation: 'contains', order: view ? (step + 1) * 16 : 0, access_scopes: accessScopes, provenance },
      { id: `${problemNodeId}.search`, source: endpoint(problemNodeId), target: endpoint(input.searchId), family: 'semantic', relation: 'about', access_scopes: accessScopes, provenance },
    ];
    const stored = view
      ? await this.service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: {
        schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash, reason: `Start alien search ${input.searchId}.`, provenance,
        add_roots: [input.searchId, uroot], add_nodes: nodes, add_edges: edges } })
      : await this.service.registerNarrativeGraph({ requestId: input.requestId, narrativeGraph: {
        schema: 'life-sim-rust-narrative-graph/v1', id: input.graphId, revision: { number: 0, reason: `Start alien search ${input.searchId}.`, provenance },
        source: { kind: 'model', model_hash: modelHash }, roots: [input.searchId, uroot], nodes, edges } });
    return { graphHash: stored.graphHash, searchRootId: input.searchId, understandingRootId: uroot, problemNodeId, modelHash, modelId: model.id,
      targetTerms: terms, graphMutation: true, worldMutation: false,
      nextStep: 'Prepare the first world with life_alien_task role builder, and run it in a fresh context that has not seen the problem.' };
  }

  // Prepare a role task and store its exact text as a record, so later outputs cite the text their
  // role actually saw and provenance survives later changes to task wording.
  async task(raw) {
    const input = taskSchema.parse(raw);
    const search = await readSearch(this.service, input);
    const task = await buildTask(this.service, { ...input, search });
    const nodeId = input.nodeId ?? `task.${input.requestId}`;
    const links = [...new Set([task.material.worldNodeId, task.material.solutionNodeId, task.material.subjectNodeId, task.material.mechanismNodeId,
      task.material.commissionNodeId].filter(Boolean))].map((targetNodeId) => ({ relation: 'uses', targetNodeId }));
    const data = { role: task.role, inputs: task.inputs, text: task.text, textHash: digest({ text: task.text }), material: task.material,
      condition: task.condition, targetBlind: task.targetBlind, purposeBlind: task.purposeBlind, targetLeaks: task.targetLeaks, preparedAtGraphHash: input.graphHash };
    const { stored } = await storeRecords(this.service, search, { requestId: input.requestId, authorId: input.authorId, accessScopes: input.accessScopes,
      reason: `Prepare alien ${task.role} task ${nodeId}.`, records: [{ nodeId, kind: 'task', title: `${task.role} task`, data, links,
        epistemicStatus: 'server_task', evidenceType: 'creative_hypothesis' }] });
    return { ...stored, taskNodeId: nodeId, role: task.role, inputs: task.inputs, text: task.text, textHash: data.textHash, material: task.material,
      condition: task.condition, targetBlind: task.targetBlind, purposeBlind: task.purposeBlind, targetLeaks: task.targetLeaks,
      recordAs: task.recordAs, isolationGuidance: task.isolationGuidance, graphMutation: true, worldMutation: false };
  }

  async resolveTask(input, search, roles, { required = true } = {}) {
    if (input.taskNodeId) return storedTask(search, input.taskNodeId, roles);
    if (input.taskRef) return verifyTaskRef(this.service, { taskRef: input.taskRef, searchRootId: input.searchRootId, accessScopes: input.accessScopes, roles });
    if (required) throw new Error(`This record cites the task it answers: pass taskNodeId from life_alien_task with role ${roles.join(' or ')}.`);
    return null;
  }

  async record(raw) {
    const input = recordSchema.parse(raw);
    const schema = recordData[input.kind];
    const data = schema.parse(input.data);
    const search = await readSearch(this.service, input);
    const links = []; const anchors = []; let stored; let title = null; let epistemicStatus; let evidenceType; let task = null;
    const warnings = [];
    if (input.kind === 'world') {
      task = await this.resolveTask(input, search, ['builder']);
      if (search.worlds.some((world) => (task.taskNodeId && world.task?.taskNodeId === task.taskNodeId) || world.task?.taskHash === task.taskHash)) {
        throw new Error('This builder task already produced a world; prepare a new task so each world keeps its own seed draw.');
      }
      const occupant = search.worlds.find((world) => world.data.seed.drawIndex === task.material.seed.drawIndex);
      if (occupant) throw new Error(`Draw slot ${task.material.seed.drawIndex} already holds world ${occupant.nodeId}; prepare the builder task again for a free slot.`);
      if (new Set(data.rules.map((rule) => rule.id)).size !== data.rules.length) throw new Error('World rule ids must be distinct.');
      Object.assign(data, { seed: task.material.seed, operators: task.material.operators, commissionNodeId: task.material.commissionNodeId,
        oraclePremise: task.material.oraclePremise, targetBlind: task.targetBlind, targetLeaks: task.targetLeaks });
      if (data.commissionNodeId) links.push({ relation: 'learned_from', targetNodeId: data.commissionNodeId });
      title = data.title; epistemicStatus = 'fictional_artifact'; evidenceType = 'fictional_canon';
      if (!task.targetBlind) warnings.push('This world is not target-blind; its record says so.');
      if (data.isolation.builder !== 'fresh_context') warnings.push('The builder did not run in a fresh context; target blindness is procedural here.');
    } else if (input.kind === 'solution') {
      task = await this.resolveTask(input, search, ['solver']);
      if (task.inputs.worldNodeId !== data.worldNodeId) throw new Error(`The solver task solves ${task.inputs.worldNodeId}, not ${data.worldNodeId}.`);
      const world = search.record(data.worldNodeId, 'world');
      const known = new Set(world.data.rules.map((rule) => rule.id));
      const unknown = data.citedRuleIds.filter((rule) => !known.has(rule));
      if (unknown.length) throw new Error(`Cited rules ${unknown.join(', ')} are not rules of ${world.nodeId}.`);
      links.push({ relation: 'solves', targetNodeId: world.nodeId });
      title = `Solve of ${world.data.title}`; epistemicStatus = 'fictional_artifact'; evidenceType = 'fictional_canon';
    } else if (input.kind === 'mechanism') {
      task = await this.resolveTask(input, search, ['compiler', 'explorer']);
      const commission = task.inputs.commissionNodeId ? search.record(task.inputs.commissionNodeId, 'commission') : null;
      const source = task.role === 'compiler'
        ? { kind: 'world', worldNodeId: task.inputs.worldNodeId, solutionNodeId: task.inputs.solutionNodeId, commissionNodeId: commission?.nodeId ?? null, retryOfNodeId: commission?.data.retryOfNodeId ?? null }
        : { kind: 'explorer', worldNodeId: null, solutionNodeId: null, commissionNodeId: commission?.nodeId ?? null, retryOfNodeId: commission?.data.retryOfNodeId ?? null };
      if (new Set(data.roles.map((item) => item.id)).size !== data.roles.length) throw new Error('Mechanism role ids must be distinct.');
      if (source.kind === 'world') {
        const world = search.record(source.worldNodeId, 'world');
        const known = new Set(world.data.rules.map((rule) => rule.id));
        const unknown = data.roles.flatMap((item) => item.worldRuleIds).filter((rule) => !known.has(rule));
        if (unknown.length) throw new Error(`Role bindings name ${[...new Set(unknown)].join(', ')}, which are not rules of ${world.nodeId}.`);
        if (!data.roles.some((item) => item.worldRuleIds.length)) throw new Error('A compiled mechanism binds at least one role to the world rules that supply it.');
        const leaks = findTargetLeaks(data.operator, targetTerms(requireProblem(search)));
        if (leaks.length) warnings.push(`The operator uses target terms (${leaks.join(', ')}); state it without the problem's domain so it can be compared across targets.`);
        data.operatorTargetTerms = leaks;
        links.push({ relation: 'compiled_from', targetNodeId: source.worldNodeId }, { relation: 'compiled_from', targetNodeId: source.solutionNodeId });
      } else {
        if (data.roles.some((item) => item.worldRuleIds.length)) throw new Error('An explorer proposal has no world, so its roles carry no world rule bindings.');
        if (data.selfAudit) throw new Error('The world self-audit applies to compiled mechanisms, not explorer proposals.');
        data.operatorTargetTerms = [];
        if (task.material.cue) data.cue = task.material.cue;
      }
      if (commission) links.push({ relation: 'answers', targetNodeId: commission.nodeId });
      if (source.retryOfNodeId) links.push({ relation: 'retries', targetNodeId: source.retryOfNodeId });
      data.source = source;
      data.condition = task.condition;
      title = data.candidate.label;
    } else if (input.kind === 'commission') {
      if (data.diagnosis) {
        const past = await readSearch(this.service, { graphHash: data.diagnosis.graphHash, searchRootId: input.searchRootId, accessScopes: input.accessScopes });
        if (diagnoseSearch(past).diagnosisHash !== data.diagnosis.diagnosisHash) throw new Error('diagnosisHash does not match the diagnosis at that graph revision.');
      }
      const state = search.ontologyState('mechanisms');
      for (const conceptId of data.avoidConceptIds) if (!state.concepts.some((concept) => concept.id === conceptId && concept.status === 'active')) {
        throw new Error(`avoidConceptIds names ${conceptId}, which is not an active mechanism family.`);
      }
      data.retryOfNodeId = null; data.alternatives = [];
      data.targetLeaks = findTargetLeaks([data.worldAsk ?? '', ...data.operators.map((item) => item.statement)].join('\n'), targetTerms(requireProblem(search)));
      if (data.addressedTo === 'new_world' && data.targetLeaks.length) warnings.push(`The world ask uses target terms (${data.targetLeaks.join(', ')}); a world built from it will not be target-blind.`);
      if (search.heads.mechanisms) links.push({ relation: 'learned_from', targetNodeId: search.heads.mechanisms.nodeId });
      title = `Commission (${data.addressedTo})`;
    } else if (input.kind === 'transfer') {
      task = await this.resolveTask(input, search, ['transfer'], { required: false });
      if (task && task.inputs.mechanismNodeId !== data.mechanismNodeId) throw new Error(`The transfer task is for ${task.inputs.mechanismNodeId}, not ${data.mechanismNodeId}.`);
      const mechanism = search.record(data.mechanismNodeId, 'mechanism');
      const expected = mechanism.data.roles.map((item) => item.id).sort();
      const mapped = data.roleMap.map((item) => item.roleId).sort();
      if (JSON.stringify(expected) !== JSON.stringify(mapped)) throw new Error(`The role map must cover each mechanism role exactly once: expected ${expected.join(', ')}, got ${mapped.join(', ')}.`);
      if (data.roleMap.every((item) => item.binding.kind === 'unfilled')) throw new Error('A transfer binds at least one role to a model record or a new component.');
      const { model } = await this.service.inspectModel({ modelHash: search.modelHash, includeDefinition: true });
      for (const item of data.roleMap) {
        if (item.binding.kind !== 'model') continue;
        const resolved = resolveModelRef(model, item.binding.ref);
        if (resolved.anchorKind) anchors.push({ relation: 'maps_role', anchorKind: resolved.anchorKind, anchorId: resolved.recordId,
          explanation: `Role ${item.roleId}: ${item.binding.how}`.slice(0, 8_000) });
      }
      data.families = search.ontologyState('mechanisms').instances.filter((item) => item.subjectNodeId === mechanism.nodeId).map((item) => item.conceptId);
      links.push({ relation: 'transfers', targetNodeId: mechanism.nodeId });
      title = data.candidate.label;
      if (data.roleMap.some((item) => item.binding.kind === 'unfilled')) warnings.push('Some roles are unfilled: the analogy is partial there, which the record keeps.');
    } else if (input.kind === 'assessment') {
      for (const subject of data.subjectNodeIds) links.push({ relation: 'assesses', targetNodeId: subject });
      title = data.verdict ?? 'Assessment'; epistemicStatus = 'authored_assessment';
    } else if (input.kind === 'selection') {
      for (const item of data.items) {
        const record = search.record(item.nodeId);
        if (!['mechanism', 'transfer'].includes(record.kind)) throw new Error(`Selection items are mechanisms or transfers; ${item.nodeId} is a ${record.kind}.`);
        links.push({ relation: 'selects', targetNodeId: item.nodeId });
      }
      const state = search.ontologyState('mechanisms');
      for (const item of data.preserved) if (!state.concepts.some((concept) => concept.id === item.conceptId && concept.status === 'active')) {
        throw new Error(`preserved names ${item.conceptId}, which is not an active mechanism family.`);
      }
      title = `Selection (${data.format})`;
    }
    if (input.note) data.note = input.note;
    if (task?.taskNodeId) links.push({ relation: 'answers', targetNodeId: task.taskNodeId });
    ({ stored } = await storeRecords(this.service, search, { requestId: input.requestId, authorId: input.authorId, accessScopes: input.accessScopes,
      reason: `Record alien ${input.kind} ${input.nodeId}.`, records: [{ nodeId: input.nodeId, kind: input.kind, data, title, links, anchors,
        epistemicStatus, evidenceType, task: task ? { taskNodeId: task.taskNodeId ?? null, role: task.role, graphHash: task.graphHash ?? task.preparedAtGraphHash,
          taskHash: task.taskHash, targetBlind: task.targetBlind, purposeBlind: task.purposeBlind } : null }] }));
    const next = {
      world: `Prepare the solver task for ${input.nodeId}, then code its causal signature with a world_curator task.`,
      solution: `Prepare the compiler task with worldNodeId and solutionNodeId ${input.nodeId}.`,
      mechanism: `Prepare curator tasks with subjectNodeId ${input.nodeId} for the mechanisms and outcomes ontologies, then record the decisions with life_alien_ontology_revise.`,
      commission: data.addressedTo === 'new_world' ? `Prepare the next builder task with commissionNodeId ${input.nodeId}.` : `Prepare an explorer task with commissionNodeId ${input.nodeId}.`,
      transfer: 'Assess the transfer, or develop it further in the target model with the general modeling tools.',
      assessment: 'Continue the loop, or record a selection when the user wants one.',
      selection: 'Export the search with life_alien_atlas when the user wants to read it.',
    }[input.kind];
    return { ...stored, recordNodeId: input.nodeId, kind: input.kind, warnings, graphMutation: true, worldMutation: false, semanticVerification: false, nextStep: next };
  }

  async reviseOntology(raw) {
    const input = reviseSchema.parse(raw);
    const search = await readSearch(this.service, input);
    const worlds = input.ontology === 'worlds';
    const decision = input.decision;
    const task = await this.resolveTask(input, search, [worlds ? 'world_curator' : 'curator'], { required: false });
    if (task) {
      if (task.inputs.subjectNodeId !== decision.subjectNodeId) throw new Error(`The curator task reviews ${task.inputs.subjectNodeId}, not ${decision.subjectNodeId}.`);
      if (!worlds && (task.inputs.ontology ?? 'mechanisms') !== input.ontology) throw new Error(`The curator task concerns the ${task.inputs.ontology} ontology, not ${input.ontology}.`);
    }
    const head = search.heads[input.ontology];
    if ((head?.nodeId ?? null) !== input.expectedHeadNodeId) {
      throw new Error(`The ${input.ontology} ontology head is ${head?.nodeId ?? 'empty'}, not ${input.expectedHeadNodeId ?? 'empty'}. Read the current head (life_alien_search_diagnose or life_alien_atlas) and revise from it.`);
    }
    const subjectKind = worlds ? 'world' : 'mechanism';
    const previous = normalizeOntology(head?.data.state);
    const { state, createdConceptIds } = applyOperations(previous, input.operations, { step: search.step,
      subjectExists: (nodeId) => search.records.some((record) => record.nodeId === nodeId && record.kind === subjectKind) });
    const verdict = decision.verdict;
    const noun = worlds ? 'regime' : input.ontology === 'outcomes' ? 'outcome class' : 'family';
    if (verdict === 'restructure_only') {
      if (decision.subjectNodeId || decision.conceptId || decision.redirect || decision.signature) throw new Error('restructure_only takes no subject, concept, redirect or signature.');
      if (!input.operations.length) throw new Error('restructure_only needs at least one operation.');
    } else {
      if (!decision.subjectNodeId) throw new Error(`${verdict} needs subjectNodeId.`);
      search.record(decision.subjectNodeId, subjectKind);
    }
    if (decision.signature && !worlds) throw new Error('A causal signature belongs to the worlds ontology.');
    const priorActive = previous.concepts.filter((concept) => concept.status === 'active').map((concept) => concept.id);
    const isActive = (conceptId, within = state) => within.concepts.some((concept) => concept.id === conceptId && concept.status === 'active');
    const assigned = (relation) => {
      const existing = state.instances.find((item) => item.subjectNodeId === decision.subjectNodeId && item.conceptId === decision.conceptId);
      if (existing && existing.relation !== relation) throw new Error(`${decision.subjectNodeId} is assigned to ${decision.conceptId} as ${existing.relation}; this verdict records it as ${relation}.`);
      if (!existing) state.instances.push({ subjectNodeId: decision.subjectNodeId, conceptId: decision.conceptId, relation, fit: decision.fit, assignedAt: search.step });
    };
    const needEquivalence = (operatorChanged) => {
      if (!decision.nearestConceptId || !isActive(decision.nearestConceptId, previous)) throw new Error(`${verdict} compares the subject with nearestConceptId, an active concept of the previous revision.`);
      if (!decision.equivalence) throw new Error(`${verdict} records the equivalence test against the nearest concept.`);
      if (operatorChanged !== undefined && decision.equivalence.primaryOperatorChanged !== operatorChanged) {
        throw new Error(operatorChanged
          ? `Admit a new ${noun} only when the primary operator changes. When only the name, actor, parameter or input signal changed, record admit_instance or equivalent.`
          : 'An equivalent subject leaves the primary operator unchanged; if the operator changed, it is not an alias.');
      }
    };
    if (verdict === 'admit_new') {
      if (!decision.conceptId || !createdConceptIds.includes(decision.conceptId)) throw new Error('admit_new names a conceptId created in this revision\'s operations.');
      if (priorActive.length) needEquivalence(true);
      assigned('instance');
    } else if (verdict === 'admit_instance') {
      if (!decision.conceptId || !isActive(decision.conceptId)) throw new Error('admit_instance names an active conceptId.');
      assigned('instance');
    } else if (verdict === 'equivalent') {
      if (!decision.conceptId || !isActive(decision.conceptId)) throw new Error('equivalent names the active conceptId the subject repeats.');
      needEquivalence(false);
      assigned('alias');
    } else if (verdict === 'reject_redirect') {
      if (!decision.redirect) throw new Error('reject_redirect names the causal relation the next proposal must change, in redirect.');
      needEquivalence();
      if (state.instances.some((item) => item.subjectNodeId === decision.subjectNodeId)) throw new Error('A rejected subject cannot also be assigned in this revision.');
      if (worlds && decision.redirect.addressedTo !== 'new_world') throw new Error('A rejected world is redirected to a new world.');
      if ((decision.redirect.addressedTo === 'new_world') !== (decision.redirect.worldAsk !== null)) throw new Error('A new-world redirect carries a worldAsk; a retry does not.');
    }
    if (verdict !== 'reject_redirect' && decision.redirect) throw new Error('Only reject_redirect carries a redirect.');
    validateOntology(state);
    const records = [{ nodeId: input.nodeId, kind: 'ontology_revision', title: `${input.ontology} ontology: ${verdict}`, data: {
      ontology: input.ontology, previousRevisionNodeId: head?.nodeId ?? null, decision, operations: input.operations, createdConceptIds,
      state, stateChanged: digest(state) !== digest(previous), commissionNodeId: decision.redirect?.commissionNodeId ?? null, isolation: input.isolation,
      stats: { concepts: state.concepts.filter((concept) => concept.status === 'active').length, partitions: state.partitions.length, relations: state.relations.length, instances: state.instances.length },
    }, links: [
      ...(head ? [{ relation: 'supersedes', family: 'revision', targetNodeId: head.nodeId }] : []),
      ...(decision.subjectNodeId ? [{ relation: 'decides', targetNodeId: decision.subjectNodeId }] : []),
      ...(task?.taskNodeId ? [{ relation: 'answers', targetNodeId: task.taskNodeId }] : []),
    ], task: task ? { taskNodeId: task.taskNodeId ?? null, role: task.role, graphHash: task.graphHash ?? task.preparedAtGraphHash, taskHash: task.taskHash } : null }];
    const warnings = [];
    if (decision.redirect) {
      const leaks = findTargetLeaks(decision.redirect.worldAsk ?? '', targetTerms(requireProblem(search)));
      if (leaks.length) warnings.push(`The world ask uses target terms (${leaks.join(', ')}); a world built from it will not be target-blind.`);
      records.push({ nodeId: decision.redirect.commissionNodeId, kind: 'commission', title: `Commission (${decision.redirect.addressedTo})`, data: {
        addressedTo: decision.redirect.addressedTo, retryOfNodeId: decision.redirect.addressedTo === 'retry' ? decision.subjectNodeId : null,
        relationToChange: decision.redirect.relationToChange, alternatives: decision.redirect.alternatives, worldAsk: decision.redirect.worldAsk,
        operators: [], avoidConceptIds: [decision.nearestConceptId], rationale: decision.rationale, diagnosis: null, targetLeaks: leaks, fromRevisionNodeId: input.nodeId,
      }, links: [{ relation: 'learned_from', targetNodeId: input.nodeId }, { relation: 'redirects', targetNodeId: decision.subjectNodeId }] });
    }
    const { stored } = await storeRecords(this.service, search, { requestId: input.requestId, authorId: input.authorId, accessScopes: input.accessScopes,
      reason: `Revise the ${input.ontology} ontology (${verdict}).`, records });
    const subject = decision.subjectNodeId ? search.record(decision.subjectNodeId) : null;
    const retry = subject?.kind === 'mechanism' && subject.data.source.kind === 'world'
      ? `a compiler task with worldNodeId ${subject.data.source.worldNodeId}, solutionNodeId ${subject.data.source.solutionNodeId} and`
      : 'an explorer task with';
    return { ...stored, revisionNodeId: input.nodeId, headNodeId: input.nodeId, commissionNodeId: decision.redirect?.commissionNodeId ?? null,
      createdConceptIds, tree: renderOntologyTree(state, { labelFor: mechanismLabel(search) }), warnings,
      graphMutation: true, worldMutation: false, semanticVerification: false,
      nextStep: decision.redirect
        ? (decision.redirect.addressedTo === 'retry' ? `Prepare ${retry} commissionNodeId ${decision.redirect.commissionNodeId}.` : `Prepare a builder task with commissionNodeId ${decision.redirect.commissionNodeId}.`)
        : 'Diagnose the search with life_alien_search_diagnose before commissioning the next world.' };
  }

  async diagnose(raw) {
    const input = readSchema.parse(raw);
    const search = await readSearch(this.service, input);
    const result = diagnoseSearch(search);
    return { graphHash: input.graphHash, searchRootId: input.searchRootId, ...result,
      heads: Object.fromEntries(ONTOLOGY_KINDS.map((ontology) => [ontology, search.heads[ontology]?.nodeId ?? null])),
      graphMutation: false, worldMutation: false,
      nextStep: 'Choose the gap you judge most useful and record a commission (kind commission, with this diagnosisHash) for a new world or an explorer, or transfer a family worth developing.' };
  }

  async atlas(raw) {
    const input = atlasSchema.parse(raw);
    const search = await readSearch(this.service, input);
    const label = mechanismLabel(search);
    const problem = search.problem?.data ?? null;
    const decisionsOf = new Map();
    for (const record of search.revisions) {
      const subject = record.data.decision.subjectNodeId;
      if (!subject) continue;
      decisionsOf.set(subject, { ...(decisionsOf.get(subject) ?? {}), [record.data.ontology]: record.data.decision });
    }
    const lines = [`# ${search.root.title ?? search.searchRootId}`, ''];
    if (problem) lines.push('## Problem', '', problem.statement, ...(problem.context ? ['', problem.context] : []), '');
    lines.push('## Mechanism ontology', '', renderOntologyTree(search.ontologyState('mechanisms'), { labelFor: label }), '');
    lines.push('## Claimed-outcome ontology', '', renderOntologyTree(search.ontologyState('outcomes'), { labelFor: label }), '');
    lines.push('## World regimes', '', renderOntologyTree(search.ontologyState('worlds'), { labelFor: label }), '');
    lines.push('## Worlds', '');
    for (const world of search.worlds) {
      const solutions = search.solutions.filter((item) => item.data.worldNodeId === world.nodeId);
      lines.push(`### ${world.data.title} (${world.nodeId})`, '',
        `Seed: ${world.data.seed.word} (${world.data.seed.source}${world.data.seed.salt ? `, salt ${world.data.seed.salt}` : ''}). Builder isolation: ${world.data.isolation.builder}. Target-blind task: ${world.data.targetBlind ? 'yes' : `no${world.data.targetLeaks.length ? ` (${world.data.targetLeaks.join(', ')})` : ' (oracle premise)'}`}.`,
        ...(world.data.operators.length ? [`Departures: ${world.data.operators.map((item) => `${item.kind}: ${item.statement}`).join('; ')}`] : []),
        ...(world.data.commissionNodeId ? [`Commissioned by ${world.data.commissionNodeId}.`] : []),
        '', `Principle: ${world.data.principle}`, '', ...world.data.rules.map((rule) => `- ${rule.id}: ${rule.statement}`), '');
      if (input.includeWorldTexts) lines.push(world.data.text, '');
      for (const solution of solutions) lines.push(`Solve (${solution.nodeId}, solver isolation ${solution.data.isolation.solver}):`, '',
        input.includeWorldTexts ? solution.data.text : `${solution.data.text.slice(0, 600)}${solution.data.text.length > 600 ? '...' : ''}`, '');
    }
    lines.push('## Mechanisms', '');
    for (const mechanism of search.mechanisms) {
      const decisions = decisionsOf.get(mechanism.nodeId) ?? {};
      const source = mechanism.data.source.kind === 'world' ? `from ${mechanism.data.source.worldNodeId}` : 'explorer proposal';
      const verdict = (ontology) => (decisions[ontology] ? `${decisions[ontology].verdict}${decisions[ontology].conceptId ? ` (${decisions[ontology].conceptId})` : ''}` : 'not yet decided');
      lines.push(`### ${mechanism.data.candidate.label} (${mechanism.nodeId}, ${source}, condition ${mechanismCondition(mechanism)}${mechanism.data.source.retryOfNodeId ? `, retry of ${mechanism.data.source.retryOfNodeId}` : ''})`, '',
        `Operator: ${mechanism.data.operator}`, '', `Strangest element: ${mechanism.data.strangest.element}. Kept as: ${mechanism.data.strangest.preserved}`, '',
        `Core mechanism: ${mechanism.data.candidate.core_mechanism}`, '', `How it works: ${mechanism.data.candidate.how_it_works}`, '',
        `Why it fails: ${mechanism.data.candidate.why_it_fails}`, '',
        `Curator: family ${verdict('mechanisms')}; claimed outcome ${verdict('outcomes')}`, '');
    }
    lines.push('## Transfers', '');
    for (const transfer of search.transfers) {
      const fitCut = transfer.data.fitCut;
      lines.push(`### ${transfer.data.candidate.label} (${transfer.nodeId}, of ${transfer.data.mechanismNodeId})`, '',
        ...transfer.data.roleMap.map((item) => `- ${item.roleId}: ${item.binding.kind === 'model' ? `${item.binding.ref} (${item.binding.how})` : item.binding.kind === 'new_component' ? `new component: ${item.binding.description}` : `unfilled: ${item.binding.reason}`}`),
        '', `Candidate: ${transfer.data.candidate.core_mechanism}`, '', `How it works: ${transfer.data.candidate.how_it_works}`, '',
        `Where the analogy breaks: ${transfer.data.disanalogies.join(' ')}`, '',
        ...(transfer.data.proxies.length ? [`Proxies: ${transfer.data.proxies.map((item) => `${item.element}: ${item.label} (${item.asOf}), ${item.proxy}`).join('; ')}`, ''] : []),
        ...(fitCut ? [`Fit Cut (${fitCut.question}; unit: ${fitCut.unit}): matches ${fitCut.matches}, does not match ${fitCut.doesNotMatch}, remainder ${fitCut.remainder}`, ''] : []),
        `Evidence needed: ${transfer.data.evidenceNeeded.join(' ')}`, '');
    }
    if (search.commissions.length) {
      lines.push('## Commissions', '');
      for (const commission of search.commissions) lines.push(`- ${commission.nodeId} (${commission.data.addressedTo}): ${commission.data.relationToChange ?? commission.data.worldAsk ?? commission.data.rationale}`);
      lines.push('');
    }
    if (search.selections.length) {
      lines.push('## Selections', '');
      for (const selection of search.selections) {
        const allocation = selection.data.allocation;
        lines.push(`- ${selection.nodeId} (${selection.data.format}${allocation ? `; ${allocation.question}; unit: ${allocation.unit}; remainder ${allocation.remainder}` : ''}): ${selection.data.items.map((item) => `${label(item.nodeId)}${item.weight !== null ? ` ${item.weight}` : ''}`).join('; ')}. ${selection.data.rationale}`);
      }
      lines.push('');
    }
    lines.push(`Tasks prepared: ${search.tasks.length}. Worlds are textual thought experiments and transfers are ideas with their mappings; nothing here is evidence that an idea works.`);
    const markdown = lines.join('\n');
    const provenance = [PROVENANCE, `search:${search.searchRootId}`, `graph:${input.graphHash}`];
    const fragments = Object.fromEntries(ONTOLOGY_KINDS.map((ontology) => [ontology,
      meaningModelFragment(search.ontologyState(ontology), { ontology, searchRootId: search.searchRootId, provenance })]));
    return { graphHash: input.graphHash, searchRootId: input.searchRootId, markdown, atlasHash: digest({ markdown }),
      meaningModelFragments: fragments,
      counts: { tasks: search.tasks.length, worlds: search.worlds.length, solutions: search.solutions.length, mechanisms: search.mechanisms.length, transfers: search.transfers.length,
        revisions: search.revisions.length, commissions: search.commissions.length, selections: search.selections.length },
      graphMutation: false, worldMutation: false,
      fragmentUse: 'Each fragment holds Meaning Model concepts and abstract relations for one active ontology: partitions become specialization relations without labels, because the engine admits relation labels only on kind other; each partition\'s lens is kept in the relation\'s provenance and in the child concept\'s differentia. Merge it into a successor of the target model and register that model to make the ontology part of the model.' };
  }
}

export function registerAlienAddon(server, service) {
  const addon = new AlienAddon(service);
  const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });
  // Paper first, as for modeling: the write tools refuse until the paper has been read in this MCP process.
  let paperRead = false;
  server.registerResource('alien-addon', RESOURCE_URI, {
    title: 'Optional Ontology of the Alien workflows',
    description: 'Opt-in world-diversity ideation: target-blind world building, in-world solving, mechanism compilation under the paper\'s conditions, curated mechanism, outcome and world-regime ontologies, diagnostic commissioning, and transfer onto a target model.',
    mimeType: 'text/markdown',
  }, async () => ({ contents: [{ uri: RESOURCE_URI, mimeType: 'text/markdown',
    text: await readFile(new URL('../../profiles/ALIEN_ADDON.md', import.meta.url), 'utf8') }] }));
  server.registerResource('ontology-of-the-alien', ALIEN_PAPER_URI, {
    title: 'Ontology of the Alien (paper)',
    description: 'Complete Ontology of the Alien manuscript: world-diversity search, ontology-governed intervention search, the study, its evidence boundary and the proposals this add-on implements. Required reading before an alien search; source digests are recorded in docs/companions/ontology-of-the-alien/SOURCE.json.',
    mimeType: 'text/x-tex',
  }, async () => {
    const text = await readFile(new URL('../../docs/companions/ontology-of-the-alien/ontology_of_the_alien.tex', import.meta.url), 'utf8');
    paperRead = true;
    return { contents: [{ uri: ALIEN_PAPER_URI, mimeType: 'text/x-tex', text }] };
  });
  server.registerPrompt('life_alien_start', {
    title: 'Search for mechanisms through invented worlds',
    description: 'Read the paper, settle the problem, the target model and the human role, then build target-blind worlds, solve and compile them, curate the mechanisms and outcomes found, commission the next world from the gaps, and transfer promising mechanisms onto the target model.',
    argsSchema: z.object({}),
  }, async () => ({ messages: [{ role: 'user', content: { type: 'text', text: `First read ${ALIEN_PAPER_URI} completely; the alien write tools refuse until it has been read in this MCP process. Then settle with the user: the problem statement and any context; the target model the ideas should land in (build it with the general modeling workflow if none exists, after reading the modeling papers); terms that would disclose the target; how many worlds to try; and who curates, the user or you under delegation. Record the problem with life_alien_search_start.\n\nRead ${RESOURCE_URI}.\n\n${alienInstructions}` } }] }));
  const gated = new Set(['life_alien_search_start', 'life_alien_task', 'life_alien_record', 'life_alien_ontology_revise']);
  for (const [name, method, schema, description, readOnly, idempotent] of [
    ['life_alien_search_start', 'startSearch', searchStartSchema,
      'Start an alien search: record the problem as an author-scoped record and create a search root, either in a new graph bound to the target model or in an existing graph. Returns the derived target terms that builder tasks are checked against.', false, false],
    ['life_alien_task', 'task', taskSchema,
      'Prepare a role task written by the server with the information that role may see, and store its exact text in the graph: builder (seed word, departures and commission; never the problem), solver (world, problem statement and constraints; not the purpose), compiler (population state none, tabu or map: the paper\'s F, G, H), explorer (optional random-word cue; population state none, tabu or map: C, A, B, D, E), curator (mechanisms or outcomes), world_curator (target-blind) or transfer. A prepared builder task reserves its draw slot. Returns the task text and the taskNodeId that records of its output must cite.', false, false],
    ['life_alien_record', 'record', recordSchema,
      `Record one output of the search as an Understanding Node in the graph, citing the stored task it answers. Kinds: world, solution, mechanism (compiled from a world or proposed by an explorer), commission (new_world or explorer), transfer (role map onto the target model, with an optional fit Cut), assessment, selection (single, portfolio, or a weighted allocation with question, unit and remainder). The server binds the world's seed and target blindness from its task and checks rule bindings, role coverage, model references, Cut sums and candidate field limits (${Object.entries(CANDIDATE_LIMITS).map(([field, limit]) => `${field} ${limit}`).join(', ')} characters).`, false, false],
    ['life_alien_ontology_revise', 'reviseOntology', reviseSchema,
      'Record a curator decision on the mechanism, claimed-outcome or world-regime ontology as a new immutable revision: admit_new, admit_instance, equivalent (alias), reject_redirect (writes a retry or new-world commission) or restructure_only, with operations (add, revise, merge or split concepts; partitions, meaning more specific kinds under a named lens; relations; instance assignments with categorical fit). The server applies the operations, checks references, acyclicity and at least two children per partition, and admits a new concept only when the equivalence test says the primary operator changed. It does not judge equivalence itself.', false, false],
    ['life_alien_search_diagnose', 'diagnose', readSchema,
      'Diagnose the search from its records: crowded and thin families and roots, saturation since the last new family, redirect chains, undecided mechanisms, uncombined family and claimed-outcome pairs, yield per condition and per world, isolation used, world signature coverage, regime-family combinations, fiat failures, open commissions, unused tasks and undeveloped branches. Returns a diagnosisHash to cite in a commission. Read-only.', true, true],
    ['life_alien_atlas', 'atlas', atlasSchema,
      'Render the whole search as Markdown (problem, all three ontologies, worlds with seeds and isolation, mechanisms with conditions, transfers, commissions and selections) and return each ontology as Meaning Model concepts and specialization relations ready to merge into a successor model. Read-only.', true, true],
  ]) {
    server.registerTool(name, { description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false } },
    async (input) => {
      if (gated.has(name) && !paperRead) {
        throw new Error(`Paper-first gate: read ${ALIEN_PAPER_URI} completely in this MCP process before using ${name}. Reading is verified only within this live process and does not prove comprehension.`);
      }
      return result(await addon[method](input));
    });
  }
}
