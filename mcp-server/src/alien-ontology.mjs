import * as z from 'zod/v4';

// A revisable ontology over one search's population: mechanism families and claimed-outcome
// classes for compiled candidates, or causal regimes for worlds. Concepts are organized by
// partitions: a partition divides a concept into more specific kinds under a named lens. In the
// Meaning Model paper's terms that is concept specialization, not expressive decomposition, so a
// partition exports as specialization relations and never as an abstract cut. The server applies
// operations and checks structure; equivalence and category judgments stay with the curator.

export const ONTOLOGY_KINDS = Object.freeze(['mechanisms', 'outcomes', 'worlds']);
// Fit of an instance to its concept is categorical: a free number would be a semantic number
// without a question, unit or remainder, which the Meaning Model paper does not admit.
export const FIT_LABELS = Object.freeze(['clear', 'partial', 'borderline']);
export const MAX_ONTOLOGY_CONCEPTS = 500;
export const MAX_ONTOLOGY_PARTITIONS = 500;
export const MAX_ONTOLOGY_RELATIONS = 2_000;
export const MAX_ONTOLOGY_INSTANCES = 5_000;

const id = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, 'Use letters, digits, dot, underscore, colon or hyphen.');
const text = (max) => z.string().trim().min(1).max(max);
const role = z.object({ id, description: text(400) }).strict();
export const CONCEPT_LIMITS = Object.freeze({ label: 200, operator: 1_200, differentia: 800, boundary: 2_000 });
const conceptFields = {
  label: text(CONCEPT_LIMITS.label),
  operator: text(CONCEPT_LIMITS.operator).describe('The primary causal operator that defines this family or regime, stated without the target domain.'),
  differentia: z.array(text(CONCEPT_LIMITS.differentia)).max(16).default([]),
  boundary: text(CONCEPT_LIMITS.boundary).nullable().default(null),
  roles: z.array(role).max(12).default([]),
};
const conceptInput = z.object({ id, ...conceptFields }).strict();
const partitionInput = z.object({
  id, parentConceptId: id, childConceptIds: z.array(id).min(2).max(32),
  lens: text(400).describe('What distinguishes the children, which are more specific kinds of the parent.'), query: text(1_000).nullable().default(null),
}).strict();
const fit = z.enum(FIT_LABELS).nullable().default(null);
const relationInput = z.object({
  id, kind: z.enum(['specialization', 'analogy', 'opposition', 'constrains', 'other']),
  sourceConceptId: id, targetConceptId: id, label: text(400).nullable().default(null),
}).strict().refine((relation) => relation.kind !== 'other' || relation.label !== null, 'A relation of kind other needs a label.');

export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_concept'), concept: conceptInput }).strict(),
  z.object({ op: z.literal('revise_concept'), conceptId: id, label: conceptFields.label.optional(), operator: conceptFields.operator.optional(),
    differentia: z.array(text(CONCEPT_LIMITS.differentia)).max(16).optional(), boundary: text(CONCEPT_LIMITS.boundary).nullable().optional(), roles: z.array(role).max(12).optional() }).strict(),
  z.object({ op: z.literal('add_partition'), partition: partitionInput }).strict(),
  z.object({ op: z.literal('revise_partition'), partitionId: id, childConceptIds: z.array(id).min(2).max(32).optional(), lens: text(400).optional(), query: text(1_000).nullable().optional() }).strict(),
  z.object({ op: z.literal('remove_partition'), partitionId: id }).strict(),
  z.object({ op: z.literal('add_relation'), relation: relationInput }).strict(),
  z.object({ op: z.literal('remove_relation'), relationId: id }).strict(),
  z.object({ op: z.literal('merge'), keepConceptId: id, mergeConceptId: id }).strict(),
  z.object({ op: z.literal('split'), conceptId: id, partitionId: id, lens: text(400), query: text(1_000).nullable().default(null),
    children: z.array(conceptInput.extend({ instanceSubjectNodeIds: z.array(id).max(1_000).default([]) }).strict()).min(2).max(32) }).strict(),
  z.object({ op: z.literal('assign_instance'), subjectNodeId: id, conceptId: id, fit }).strict(),
  z.object({ op: z.literal('unassign_instance'), subjectNodeId: id, conceptId: id }).strict(),
  // Graded membership is a Cut: one declared question and unit divided among the concepts a subject
  // draws on, plus an explicit remainder. It sits beside the categorical instance assignments.
  z.object({ op: z.literal('set_membership'), subjectNodeId: id, question: text(400), unit: text(200),
    shares: z.array(z.object({ conceptId: id, share: z.number().min(0).max(1) }).strict()).min(2).max(12),
    remainder: z.number().min(0).max(1) }).strict(),
  z.object({ op: z.literal('clear_membership'), subjectNodeId: id }).strict(),
]);

export const equivalenceSchema = z.object({
  nameChanged: z.boolean(), actorChanged: z.boolean(), parameterChanged: z.boolean(), inputSignalChanged: z.boolean(),
  primaryOperatorChanged: z.boolean().describe('Does the candidate change the primary causal operator relative to the nearest concept, rather than only its name, actor, parameter or input signal?'),
  explanation: text(2_000),
}).strict();

export function emptyOntology() {
  return { concepts: [], partitions: [], relations: [], instances: [], memberships: [] };
}

// States stored before partitions were named used a cuts array and numeric fit; read them as partitions.
export function normalizeOntology(stored) {
  if (!stored) return emptyOntology();
  const { cuts, ...rest } = stored;
  return { ...rest, partitions: rest.partitions ?? cuts ?? [],
    instances: (rest.instances ?? []).map((item) => (typeof item.fit === 'number' ? { ...item, fit: null } : item)),
    memberships: rest.memberships ?? [] };
}

function fail(message) {
  throw new Error(`Ontology revision rejected: ${message}`);
}

function activeConcept(state, conceptId, purpose) {
  const concept = state.concepts.find((item) => item.id === conceptId);
  if (!concept) fail(`${purpose} names unknown concept ${conceptId}.`);
  if (concept.status !== 'active') fail(`${purpose} names concept ${conceptId}, which was merged into ${concept.mergedInto}.`);
  return concept;
}

function assertNewId(state, recordId) {
  if (state.concepts.some((item) => item.id === recordId) || state.partitions.some((item) => item.id === recordId)
    || state.relations.some((item) => item.id === recordId)) fail(`identifier ${recordId} is already used in this ontology.`);
}

function createConcept(state, input, step) {
  assertNewId(state, input.id);
  const concept = { id: input.id, label: input.label, operator: input.operator, differentia: input.differentia ?? [],
    boundary: input.boundary ?? null, roles: input.roles ?? [], status: 'active', mergedInto: null, createdAt: step };
  if (new Set(concept.roles.map((item) => item.id)).size !== concept.roles.length) fail(`concept ${concept.id} repeats a role id.`);
  state.concepts.push(concept);
  return concept;
}

function assign(state, subjectNodeId, conceptId, fitLabel, step, relation = 'instance') {
  activeConcept(state, conceptId, `Instance ${subjectNodeId}`);
  if (state.instances.some((item) => item.subjectNodeId === subjectNodeId && item.conceptId === conceptId)) {
    fail(`${subjectNodeId} is already assigned to ${conceptId}.`);
  }
  state.instances.push({ subjectNodeId, conceptId, relation, fit: fitLabel ?? null, assignedAt: step });
}

// Apply operations to a copy of the previous state; the input state is never mutated.
export function applyOperations(previous, operations, { step, subjectExists = () => true } = {}) {
  const state = structuredClone(normalizeOntology(previous));
  const created = new Set();
  for (const [index, raw] of operations.entries()) {
    const operation = operationSchema.parse(raw);
    const at = `operation ${index} (${operation.op})`;
    switch (operation.op) {
      case 'add_concept': created.add(createConcept(state, operation.concept, step).id); break;
      case 'revise_concept': {
        const concept = activeConcept(state, operation.conceptId, at);
        for (const key of ['label', 'operator', 'differentia', 'boundary', 'roles']) if (operation[key] !== undefined) concept[key] = operation[key];
        if (new Set(concept.roles.map((item) => item.id)).size !== concept.roles.length) fail(`${at} repeats a role id.`);
        break;
      }
      case 'add_partition': {
        assertNewId(state, operation.partition.id);
        state.partitions.push({ id: operation.partition.id, parentConceptId: operation.partition.parentConceptId, childConceptIds: [...operation.partition.childConceptIds],
          lens: operation.partition.lens, query: operation.partition.query ?? null });
        break;
      }
      case 'revise_partition': {
        const partition = state.partitions.find((item) => item.id === operation.partitionId);
        if (!partition) fail(`${at} names unknown partition ${operation.partitionId}.`);
        for (const key of ['childConceptIds', 'lens', 'query']) if (operation[key] !== undefined) partition[key] = operation[key];
        break;
      }
      case 'remove_partition': {
        const before = state.partitions.length;
        state.partitions = state.partitions.filter((item) => item.id !== operation.partitionId);
        if (state.partitions.length === before) fail(`${at} names unknown partition ${operation.partitionId}.`);
        break;
      }
      case 'add_relation': {
        assertNewId(state, operation.relation.id);
        state.relations.push({ ...operation.relation });
        break;
      }
      case 'remove_relation': {
        const before = state.relations.length;
        state.relations = state.relations.filter((item) => item.id !== operation.relationId);
        if (state.relations.length === before) fail(`${at} names unknown relation ${operation.relationId}.`);
        break;
      }
      case 'merge': {
        if (operation.keepConceptId === operation.mergeConceptId) fail(`${at} merges a concept into itself.`);
        activeConcept(state, operation.keepConceptId, at);
        const merged = activeConcept(state, operation.mergeConceptId, at);
        merged.status = 'merged'; merged.mergedInto = operation.keepConceptId;
        const keep = operation.keepConceptId; const gone = operation.mergeConceptId;
        const seen = new Set();
        state.instances = state.instances.map((item) => item.conceptId === gone ? { ...item, conceptId: keep } : item)
          .filter((item) => { const key = `${item.subjectNodeId}\u0000${item.conceptId}`; if (seen.has(key)) return false; seen.add(key); return true; });
        for (const partition of state.partitions) {
          if (partition.parentConceptId === gone) partition.parentConceptId = keep;
          partition.childConceptIds = [...new Set(partition.childConceptIds.map((child) => child === gone ? keep : child))];
        }
        state.relations = state.relations.map((relation) => ({ ...relation,
          sourceConceptId: relation.sourceConceptId === gone ? keep : relation.sourceConceptId,
          targetConceptId: relation.targetConceptId === gone ? keep : relation.targetConceptId }))
          .filter((relation) => relation.sourceConceptId !== relation.targetConceptId);
        // A merged concept's membership share joins the kept concept's share; the Cut still sums to one.
        state.memberships = state.memberships.map((membership) => {
          const folded = new Map();
          for (const item of membership.shares) {
            const conceptId = item.conceptId === gone ? keep : item.conceptId;
            folded.set(conceptId, (folded.get(conceptId) ?? 0) + item.share);
          }
          return { ...membership, shares: [...folded].map(([conceptId, value]) => ({ conceptId, share: value })) };
        });
        break;
      }
      case 'split': {
        activeConcept(state, operation.conceptId, at);
        assertNewId(state, operation.partitionId);
        const claimed = new Set();
        for (const child of operation.children) {
          created.add(createConcept(state, child, step).id);
          for (const subjectNodeId of child.instanceSubjectNodeIds) {
            if (claimed.has(subjectNodeId)) fail(`${at} assigns ${subjectNodeId} to two children.`);
            claimed.add(subjectNodeId);
            const current = state.instances.find((item) => item.subjectNodeId === subjectNodeId && item.conceptId === operation.conceptId);
            if (!current) fail(`${at} moves ${subjectNodeId}, which is not an instance of ${operation.conceptId}.`);
            current.conceptId = child.id;
          }
        }
        state.partitions.push({ id: operation.partitionId, parentConceptId: operation.conceptId, childConceptIds: operation.children.map((child) => child.id),
          lens: operation.lens, query: operation.query ?? null });
        break;
      }
      case 'assign_instance': {
        if (!subjectExists(operation.subjectNodeId)) fail(`${at} names ${operation.subjectNodeId}, which is not a record of this ontology's kind in the search.`);
        assign(state, operation.subjectNodeId, operation.conceptId, operation.fit, step);
        break;
      }
      case 'unassign_instance': {
        const before = state.instances.length;
        state.instances = state.instances.filter((item) => !(item.subjectNodeId === operation.subjectNodeId && item.conceptId === operation.conceptId));
        if (state.instances.length === before) fail(`${at}: ${operation.subjectNodeId} is not assigned to ${operation.conceptId}.`);
        break;
      }
      case 'set_membership': {
        if (!subjectExists(operation.subjectNodeId)) fail(`${at} names ${operation.subjectNodeId}, which is not a record of this ontology's kind in the search.`);
        for (const item of operation.shares) activeConcept(state, item.conceptId, at);
        state.memberships = state.memberships.filter((item) => item.subjectNodeId !== operation.subjectNodeId);
        state.memberships.push({ subjectNodeId: operation.subjectNodeId, question: operation.question, unit: operation.unit,
          shares: operation.shares.map((item) => ({ ...item })), remainder: operation.remainder, setAt: step });
        break;
      }
      case 'clear_membership': {
        const before = state.memberships.length;
        state.memberships = state.memberships.filter((item) => item.subjectNodeId !== operation.subjectNodeId);
        if (state.memberships.length === before) fail(`${at}: ${operation.subjectNodeId} has no graded membership.`);
        break;
      }
      default: fail(`${at} is not supported.`);
    }
  }
  validateOntology(state);
  return { state, createdConceptIds: [...created] };
}

export function validateOntology(state) {
  if (state.concepts.length > MAX_ONTOLOGY_CONCEPTS || state.partitions.length > MAX_ONTOLOGY_PARTITIONS
    || state.relations.length > MAX_ONTOLOGY_RELATIONS || state.instances.length > MAX_ONTOLOGY_INSTANCES) {
    fail('the ontology exceeds a concept, partition, relation or instance limit.');
  }
  const concepts = new Map(state.concepts.map((concept) => [concept.id, concept]));
  if (concepts.size !== state.concepts.length) fail('concept identifiers must be unique.');
  const active = (conceptId, purpose) => {
    const concept = concepts.get(conceptId);
    if (!concept) fail(`${purpose} names unknown concept ${conceptId}.`);
    if (concept.status !== 'active') fail(`${purpose} names merged concept ${conceptId}.`);
  };
  const edges = new Map([...concepts.keys()].map((conceptId) => [conceptId, []]));
  for (const partition of state.partitions) {
    active(partition.parentConceptId, `Partition ${partition.id}`);
    for (const child of partition.childConceptIds) active(child, `Partition ${partition.id}`);
    if (new Set(partition.childConceptIds).size !== partition.childConceptIds.length || partition.childConceptIds.length < 2) {
      fail(`partition ${partition.id} needs at least two distinct children; after a merge, restructure or remove the partition.`);
    }
    if (partition.childConceptIds.includes(partition.parentConceptId)) fail(`partition ${partition.id} lists its parent as a child.`);
    for (const child of partition.childConceptIds) edges.get(partition.parentConceptId).push(child);
  }
  const relationKeys = new Set();
  for (const relation of state.relations) {
    active(relation.sourceConceptId, `Relation ${relation.id}`);
    active(relation.targetConceptId, `Relation ${relation.id}`);
    if (relation.sourceConceptId === relation.targetConceptId) fail(`relation ${relation.id} connects a concept to itself.`);
    // Two relations of one kind between the same concepts may state different aspects; only an identical label repeats.
    const key = `${relation.kind}\u0000${relation.sourceConceptId}\u0000${relation.targetConceptId}\u0000${relation.label ?? ''}`;
    if (relationKeys.has(key)) fail(`relation ${relation.id} repeats an existing ${relation.kind} relation with the same label.`);
    relationKeys.add(key);
    if (relation.kind === 'specialization') edges.get(relation.sourceConceptId).push(relation.targetConceptId);
  }
  // Partitions and specializations together must stay a directed acyclic graph.
  const marks = new Map();
  const visit = (node, path) => {
    if (marks.get(node) === 'done') return;
    if (marks.get(node) === 'open') fail(`the concept hierarchy has a cycle through ${[...path, node].join(' -> ')}.`);
    marks.set(node, 'open');
    for (const next of edges.get(node)) visit(next, [...path, node]);
    marks.set(node, 'done');
  };
  for (const node of edges.keys()) visit(node, []);
  const instanceKeys = new Set();
  for (const instance of state.instances) {
    active(instance.conceptId, `Instance ${instance.subjectNodeId}`);
    const key = `${instance.subjectNodeId}\u0000${instance.conceptId}`;
    if (instanceKeys.has(key)) fail(`${instance.subjectNodeId} is assigned twice to ${instance.conceptId}.`);
    instanceKeys.add(key);
  }
  const memberships = state.memberships ?? [];
  if (memberships.length > MAX_ONTOLOGY_INSTANCES) fail('the ontology exceeds the graded-membership limit.');
  const members = new Set();
  for (const membership of memberships) {
    if (members.has(membership.subjectNodeId)) fail(`${membership.subjectNodeId} has two graded memberships.`);
    members.add(membership.subjectNodeId);
    const ids = membership.shares.map((item) => item.conceptId);
    for (const conceptId of ids) active(conceptId, `Membership of ${membership.subjectNodeId}`);
    if (new Set(ids).size !== ids.length || ids.length < 2) fail(`the graded membership of ${membership.subjectNodeId} names at least two distinct concepts.`);
    const total = membership.shares.reduce((sum, item) => sum + item.share, 0) + membership.remainder;
    if (Math.abs(total - 1) > 1e-9) fail(`the graded membership of ${membership.subjectNodeId} is a Cut: its shares and remainder sum to 1, not ${Number(total.toFixed(6))}.`);
  }
  return true;
}

// Children of each concept through cuts and specializations, for trees and gap counts.
export function hierarchy(stored) {
  const state = normalizeOntology(stored);
  const children = new Map(state.concepts.filter((concept) => concept.status === 'active').map((concept) => [concept.id, new Set()]));
  const parents = new Map([...children.keys()].map((conceptId) => [conceptId, new Set()]));
  for (const partition of state.partitions) for (const child of partition.childConceptIds) { children.get(partition.parentConceptId)?.add(child); parents.get(child)?.add(partition.parentConceptId); }
  for (const relation of state.relations) if (relation.kind === 'specialization') {
    children.get(relation.sourceConceptId)?.add(relation.targetConceptId); parents.get(relation.targetConceptId)?.add(relation.sourceConceptId);
  }
  const roots = [...children.keys()].filter((conceptId) => parents.get(conceptId).size === 0).sort();
  return { children, parents, roots };
}

export function instanceCounts(stored) {
  const state = normalizeOntology(stored);
  const direct = new Map(state.concepts.map((concept) => [concept.id, { instances: 0, aliases: 0 }]));
  for (const instance of state.instances) {
    const count = direct.get(instance.conceptId);
    if (instance.relation === 'alias') count.aliases += 1; else count.instances += 1;
  }
  // Each concept's descendants (itself included), memoized; the hierarchy is acyclic.
  const { children } = hierarchy(state);
  const descendants = new Map();
  const collect = (conceptId) => {
    if (descendants.has(conceptId)) return descendants.get(conceptId);
    const found = new Set([conceptId]);
    for (const child of children.get(conceptId) ?? []) for (const item of collect(child)) found.add(item);
    descendants.set(conceptId, found);
    return found;
  };
  const subtree = new Map();
  for (const concept of state.concepts) {
    if (concept.status !== 'active') continue;
    const within = collect(concept.id);
    subtree.set(concept.id, new Set(state.instances.filter((item) => item.relation !== 'alias' && within.has(item.conceptId))
      .map((item) => item.subjectNodeId)).size);
  }
  return { direct, subtree };
}

export function renderOntologyTree(stored, { labelFor = (subjectNodeId) => subjectNodeId } = {}) {
  const state = normalizeOntology(stored);
  if (!state.concepts.some((concept) => concept.status === 'active')) return '(empty)';
  const { children, roots } = hierarchy(state);
  const { direct, subtree } = instanceCounts(state);
  const concepts = new Map(state.concepts.map((concept) => [concept.id, concept]));
  const lines = [];
  const printed = new Set();
  const line = (conceptId, depth, via) => {
    const concept = concepts.get(conceptId);
    const counts = direct.get(conceptId);
    const suffix = printed.has(conceptId) ? ' (shown above)' : '';
    lines.push(`${'  '.repeat(depth)}- [${conceptId}] ${concept.label}${via ? ` (${via})` : ''}: ${counts.instances} direct, ${subtree.get(conceptId)} in subtree${counts.aliases ? `, ${counts.aliases} alias` : ''}${suffix}`);
    if (printed.has(conceptId)) return;
    printed.add(conceptId);
    lines.push(`${'  '.repeat(depth + 1)}operator: ${concept.operator}`);
    const instances = state.instances.filter((item) => item.conceptId === conceptId);
    if (instances.length) lines.push(`${'  '.repeat(depth + 1)}instances: ${instances.map((item) => `${labelFor(item.subjectNodeId)}${item.relation === 'alias' ? ' (alias)' : ''}${item.fit ? ` (${item.fit} fit)` : ''}`).join('; ')}`);
    const viaPartition = new Set();
    for (const partition of state.partitions.filter((item) => item.parentConceptId === conceptId)) {
      lines.push(`${'  '.repeat(depth + 1)}partition ${partition.id}, lens: ${partition.lens}${partition.query ? `; query: ${partition.query}` : ''}`);
      for (const child of partition.childConceptIds) { viaPartition.add(child); line(child, depth + 2, null); }
    }
    for (const child of [...(children.get(conceptId) ?? [])].filter((item) => !viaPartition.has(item)).sort()) line(child, depth + 1, 'specializes');
  };
  for (const root of roots) line(root, 0, null);
  const other = state.relations.filter((relation) => relation.kind !== 'specialization');
  if (other.length) {
    lines.push('', 'Relations:');
    for (const relation of other) lines.push(`- ${relation.sourceConceptId} ${relation.kind} ${relation.targetConceptId}${relation.label ? `: ${relation.label}` : ''}`);
  }
  if (state.memberships.length) {
    lines.push('', 'Graded membership (Cuts):');
    for (const membership of state.memberships) lines.push(`- ${labelFor(membership.subjectNodeId)}: ${membership.shares.map((item) => `${item.conceptId} ${item.share}`).join(', ')}, remainder ${membership.remainder} (${membership.question}; unit: ${membership.unit})`);
  }
  return lines.join('\n');
}

// Meaning Model concept and abstract-relation records for the active part of the ontology,
// ready to merge into a model's meaning_model. Roles become the concept's state schema and the
// operator leads its differentia. A partition becomes specialization relations from the parent to
// its children, and its lens becomes a differentia of each child, since the lens is what tells the
// kinds apart; abstract cuts are left for expressive decompositions. The engine admits a label only
// on kind other, so a typed relation keeps its kind and any aspect note moves to its provenance.
// The engine bounds each concept text (label, boundary, each differentia entry, each provenance entry)
// at 1,024 bytes. Longer ontology texts are split at sentence, then word, boundaries into several
// entries rather than truncated, so the exported concept keeps every word.
const MAX_ENGINE_TEXT_BYTES = 1_024;
export function engineTexts(text, lead = '', more = 'continued: ') {
  const pieces = [];
  let rest = String(text).trim();
  let prefix = lead;
  while (rest.length) {
    const budget = MAX_ENGINE_TEXT_BYTES - Buffer.byteLength(prefix);
    if (Buffer.byteLength(rest) <= budget) { pieces.push(prefix + rest); break; }
    let fits = 0; let bytes = 0;
    for (const char of rest) { const size = Buffer.byteLength(char); if (bytes + size > budget) break; bytes += size; fits += char.length; }
    const window = rest.slice(0, fits);
    const sentence = window.lastIndexOf('. ');
    const space = window.lastIndexOf(' ');
    const at = sentence > fits / 2 ? sentence + 1 : space > 0 ? space : fits;
    pieces.push(prefix + rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
    prefix = more;
  }
  return pieces;
}

export function meaningModelFragment(stored, { ontology, searchRootId, provenance }) {
  const state = normalizeOntology(stored);
  const prefix = `alien.${searchRootId}.${ontology}.`;
  const active = state.concepts.filter((concept) => concept.status === 'active');
  const activeIds = new Set(active.map((concept) => concept.id));
  const partitions = state.partitions.filter((partition) => activeIds.has(partition.parentConceptId));
  const lensesOf = (conceptId) => partitions.filter((partition) => partition.childConceptIds.includes(conceptId)).map((partition) => {
    const parent = state.concepts.find((concept) => concept.id === partition.parentConceptId);
    return engineTexts(`Distinguished within ${parent.label} by: ${partition.lens}`);
  }).flat();
  return {
    concepts: active.map((concept) => {
      const boundary = concept.boundary ? engineTexts(concept.boundary, '', 'Boundary, continued: ') : [null];
      const differentia = [...engineTexts(concept.operator, 'Operator: ', 'Operator, continued: '), ...concept.differentia.flatMap((item) => engineTexts(item)),
        ...lensesOf(concept.id), ...boundary.slice(1)];
      return { id: prefix + concept.id, label: concept.label, differentia: [...new Set(differentia)], boundary: boundary[0],
      state_schema: Object.fromEntries(concept.roles.map((item) => [item.id, item.description])),
      direction_families: [], observation_methods: [], provenance };
    }),
    abstract_cuts: [],
    abstract_relations: [
      ...partitions.flatMap((partition) => partition.childConceptIds.map((child) => ({
        id: `${prefix}${partition.id}.${child}`, source_concept_id: prefix + partition.parentConceptId, target_concept_id: prefix + child,
        kind: 'specialization', label: null, provenance: [...provenance, ...engineTexts(`partition ${partition.id}, lens: ${partition.lens}`)] }))),
      ...state.relations.map((relation) => ({ id: prefix + relation.id, source_concept_id: prefix + relation.sourceConceptId,
        target_concept_id: prefix + relation.targetConceptId, kind: relation.kind,
        label: relation.kind === 'other' ? relation.label : null,
        provenance: relation.kind !== 'other' && relation.label ? [...provenance, ...engineTexts(`aspect: ${relation.label}`)] : provenance })),
    ],
  };
}
