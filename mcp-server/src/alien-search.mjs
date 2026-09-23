import { createHash } from 'node:crypto';
import { normalizeOntology, ONTOLOGY_KINDS } from './alien-ontology.mjs';

// Graph I/O for the alien add-on. A search is a document root in the Meaning Model
// narrative graph; every world, solve, compiled mechanism, ontology revision,
// commission, transfer and assessment is a node under the search's understanding root,
// linked back to the search. Nothing is kept outside the graph.

export const RECORD_SCHEMA = 'meaning-model-alien-record/v1';
export const SEARCH_NODE_TYPE = 'alien.search';
export const PROVENANCE = 'Meaning Model alien add-on v1';
// imported: the record came from a world library; its original isolation is kept in the library provenance.
export const ISOLATION = Object.freeze(['fresh_context', 'same_context', 'human', 'imported']);
export const REFLECTION_KINDS = new Set(['ontology_revision', 'commission', 'assessment', 'selection']);
const MAX_RECORD_BYTES = 512 * 1024;

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function understandingRootId(searchRootId) {
  return `alien.understanding.${createHash('sha256').update(searchRootId).digest('hex').slice(0, 24)}`;
}

export function sortedScopes(scopes) {
  return [...new Set(scopes)].sort();
}

// A reviewed bank of uncommon but real words from natural history, geology, crafts,
// law, music, signals and the body. Rare words displace ordinary premises better than
// the storytelling bank's everyday words; a caller may still supply any seed.
export const alienSeedWords = Object.freeze([
  'lichen', 'mycelium', 'rhizome', 'chrysalis', 'moult', 'tendril', 'gall', 'nacre',
  'coral', 'plankton', 'barnacle', 'lamprey', 'cuckoo', 'murmuration', 'hibernation', 'pollination',
  'grafting', 'coppice', 'fallow', 'humus', 'compost', 'ferment', 'rennet', 'brine',
  'amber', 'resin', 'pith', 'moraine', 'scree', 'silt', 'estuary', 'fjord',
  'geyser', 'tundra', 'permafrost', 'monsoon', 'doldrums', 'undertow', 'riptide', 'eddy',
  'whirlpool', 'avalanche', 'erosion', 'sediment', 'stalactite', 'geode', 'obsidian', 'lodestone',
  'flint', 'tourmaline', 'hoarfrost', 'rime', 'mirage', 'halo', 'aurora', 'eclipse',
  'perihelion', 'parallax', 'refraction', 'resonance', 'inertia', 'friction', 'buoyancy', 'osmosis',
  'capillarity', 'siphon', 'viscosity', 'entropy', 'isotope', 'catalyst', 'enzyme', 'membrane',
  'crystallization', 'magnetism', 'neap', 'loom', 'shuttle', 'bobbin', 'warp', 'weft',
  'selvage', 'felt', 'lacquer', 'enamel', 'solder', 'anneal', 'temper', 'quench',
  'crucible', 'kiln', 'bellows', 'anvil', 'lathe', 'mortise', 'dovetail', 'keystone',
  'buttress', 'cistern', 'aqueduct', 'sluice', 'weir', 'caisson', 'ballast', 'keel',
  'tether', 'tithe', 'dowry', 'ransom', 'bail', 'jubilee', 'amnesty', 'quarantine',
  'embargo', 'tariff', 'toll', 'barter', 'potlatch', 'quorum', 'census', 'almanac',
  'palimpsest', 'cipher', 'palindrome', 'anagram', 'acrostic', 'marginalia', 'errata', 'colophon',
  'watermark', 'fugue', 'canon', 'cadence', 'syncopation', 'tremolo', 'overtone', 'drone',
  'counterpoint', 'refrain', 'antiphony', 'understudy', 'masquerade', 'pantomime', 'semaphore', 'beacon',
  'relay', 'courier', 'caravan', 'ferry', 'switchback', 'portage', 'pilgrimage', 'exile',
  'diaspora', 'nomad', 'apiary', 'dovecote', 'aviary', 'terrarium', 'herbarium', 'reliquary',
  'ossuary', 'labyrinth', 'mosaic', 'tessellation', 'fractal', 'lattice', 'honeycomb', 'filament',
  'wick', 'tallow', 'soot', 'patina', 'verdigris', 'tarnish', 'reverberation', 'vertigo',
  'insomnia', 'somnambulism', 'amnesia', 'hindsight', 'prophecy', 'chimera', 'metamorphosis', 'camouflage',
  'mimicry', 'parasite', 'siege', 'truce', 'vigil', 'wake', 'threshold', 'antechamber',
]);

// The draw depends on the search and a slot, so preparing the same task twice draws the
// same word and each slot draws its own. A salt draws again; the world record keeps the
// salt, so a re-draw is visible.
export function drawSeed(searchRootId, drawIndex, salt = null) {
  const bytes = createHash('sha256').update(JSON.stringify(['alien-seed/v1', searchRootId, drawIndex, salt])).digest();
  const position = bytes.readUInt32BE(0) % alienSeedWords.length;
  return { word: alienSeedWords[position], source: 'bank', bankId: 'alien-uncommon-words/v1', bankSize: alienSeedWords.length, position, drawIndex, salt };
}

const STOPWORDS = new Set(`a about above across after again against all also am among an and any are as at be because been before being below
between both but by can cannot could did do does doing done dont during each either even every for from get gets got had has have having
help her here his how however i if impossible in into is it its itself just know known like long lot lots make many may me more most much
must my need needs neither never new next no nor not now of off often on once only onto or other others our ours out over own part parts
people person possible problem problems same shall she should since so some such than that the their them then there these they thing things
this those though through thus to toward towards under until up upon us use used using very want wants was way ways we well were what when
where whether which while who whom whose why will with within without work works would yet you your system systems build design create
solution solutions world worlds life lives time times year years day days good better best able kind number amount high low large small short`.split(/\s+/u));

// Longest suffix first; a final e is dropped so retire, retires and retirement meet.
const SUFFIXES = ['ations', 'ation', 'nesses', 'ments', 'ment', 'ness', 'ings', 'ing', 'ions', 'ion', 'ities', 'ity', 'ency', 'ence', 'ancy', 'ance',
  'ent', 'ant', 'ies', 'ers', 'er', 'ed', 'es', 'ly', 's'];
export function stem(word) {
  let lower = word.toLowerCase();
  for (const suffix of SUFFIXES) if (lower.endsWith(suffix) && lower.length - suffix.length >= 4) { lower = lower.slice(0, -suffix.length); break; }
  return lower.length > 4 && lower.endsWith('e') ? lower.slice(0, -1) : lower;
}

function words(text) {
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((word) => word.replace(/['’][\p{L}]+$/u, ''));
}

// Terms whose appearance in a target-blind task would disclose the target. The derived
// list is a heuristic over the problem statement only: context often carries background or
// meta text whose words would raise false flags. Explicit terms are always used.
export function targetTerms(problem) {
  const explicit = (problem.targetTerms ?? []).map((term) => term.trim().toLowerCase()).filter(Boolean);
  const derived = problem.deriveTargetTerms === false ? [] : words(problem.statement)
    .map((word) => word.toLowerCase()).filter((word) => word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/u.test(word));
  return [...new Set([...explicit, ...derived])].sort();
}

export function findTargetLeaks(text, terms) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const stems = new Set(words(text).map(stem));
  return terms.filter((term) => (/\s/u.test(term) ? lower.includes(term) : stems.has(stem(term)))).sort();
}

function parsePayload(node) {
  try {
    const payload = JSON.parse(node.text);
    return payload?.schema === RECORD_SCHEMA ? payload : null;
  } catch { return null; }
}

// Read one search at an exact graph revision. Hidden records stay hidden: the caller's
// access scopes decide which records, including the problem, this view contains.
export async function readSearch(service, { graphHash, searchRootId, accessScopes }) {
  const scopes = sortedScopes(accessScopes);
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  if (view.graph_hash !== graphHash || !view.content_included) throw new Error('The alien add-on requires the exact graph with content.');
  const root = view.nodes.find((node) => node.id === searchRootId);
  if (!root || root.role !== 'document_root' || root.node_type !== SEARCH_NODE_TYPE) {
    throw new Error(`Search root ${searchRootId} is unknown, inaccessible or not an alien search. Start one with life_alien_search_start.`);
  }
  const step = view.graph.revision?.number;
  if (!Number.isSafeInteger(step) || step < 0) throw new Error('The search requires a safe graph-revision clock.');
  const modelHash = view.graph.source_snapshot?.model_hash;
  if (typeof modelHash !== 'string' || modelHash.length !== 64) throw new Error('The search graph must be bound to a registered target model.');
  const records = [];
  for (const node of view.nodes) {
    if (!node.node_type?.startsWith('alien.') || node.node_type === SEARCH_NODE_TYPE || node.subject !== searchRootId) continue;
    const payload = parsePayload(node);
    if (!payload || `alien.${payload.kind}` !== node.node_type) continue;
    records.push({ nodeId: node.id, kind: payload.kind, data: payload.data, task: payload.task ?? null, clock: payload.searchClock, node });
  }
  records.sort((a, b) => (a.clock?.at ?? 0) - (b.clock?.at ?? 0) || (a.clock?.index ?? 0) - (b.clock?.index ?? 0) || a.nodeId.localeCompare(b.nodeId));
  const byKind = (kind) => records.filter((record) => record.kind === kind);
  const heads = {};
  for (const ontology of ONTOLOGY_KINDS) {
    const revisions = byKind('ontology_revision').filter((record) => record.data.ontology === ontology);
    const superseded = new Set(revisions.map((record) => record.data.previousRevisionNodeId).filter(Boolean));
    const open = revisions.filter((record) => !superseded.has(record.nodeId));
    if (open.length > 1) throw new Error(`The ${ontology} ontology has more than one head (${open.map((record) => record.nodeId).join(', ')}).`);
    heads[ontology] = open[0] ?? null;
  }
  return {
    view, root, scopes, step, modelHash, understandingRootId: understandingRootId(searchRootId), searchRootId, records,
    problem: byKind('problem')[0] ?? null, tasks: byKind('task'),
    worlds: byKind('world'), solutions: byKind('solution'), mechanisms: byKind('mechanism'),
    revisions: byKind('ontology_revision'), commissions: byKind('commission'), transfers: byKind('transfer'),
    assessments: byKind('assessment'), selections: byKind('selection'), decisionChecks: byKind('decision_check'), heads,
    ontologyState: (ontology) => normalizeOntology(heads[ontology]?.data.state),
    record: (nodeId, kind) => {
      const found = records.find((record) => record.nodeId === nodeId);
      if (!found || (kind && found.kind !== kind)) throw new Error(`${nodeId} is not ${kind ? `a ${kind} record` : 'a record'} of search ${searchRootId} visible with these access scopes.`);
      return found;
    },
  };
}

export function requireProblem(search) {
  if (!search.problem) throw new Error('The search problem is not visible with these access scopes; pass the scope it was recorded with.');
  return search.problem.data;
}

const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });

// Store one or more records in a single batch. Scopes narrow to what every linked target
// shares, as for storytelling author records, so a record never widens an audience.
export async function storeRecords(service, search, { requestId, authorId, accessScopes, reason, records }) {
  if (Buffer.byteLength(JSON.stringify(records)) > MAX_RECORD_BYTES) throw new Error('Alien records exceed 512 KiB.');
  const nodes = new Map(search.view.nodes.map((node) => [node.id, node]));
  let scopes = sortedScopes(accessScopes);
  if (!scopes.length) throw new Error('Alien records need at least one explicit access scope.');
  const batchIds = new Set(records.map((record) => record.nodeId));
  if (batchIds.size !== records.length) throw new Error('Record node IDs in one call must be distinct.');
  for (const record of records) {
    if (nodes.has(record.nodeId) || record.nodeId === search.understandingRootId) throw new Error(`Node ${record.nodeId} already exists; use a new node ID.`);
    for (const link of record.links ?? []) {
      if (batchIds.has(link.targetNodeId)) continue;
      const target = nodes.get(link.targetNodeId);
      if (!target) throw new Error(`Record link target is unknown or inaccessible: ${link.targetNodeId}.`);
      if (target.access_scopes?.length) scopes = scopes.filter((scope) => target.access_scopes.includes(scope));
    }
  }
  for (const container of [search.root, nodes.get(search.understandingRootId)]) {
    if (container?.access_scopes?.length) scopes = scopes.filter((scope) => container.access_scopes.includes(scope));
  }
  if (!scopes.length) throw new Error('The records and their targets share no access scope.');
  const provenance = [PROVENANCE, `author:${authorId}`, 'Search clock: search_step, not world time.'];
  const common = { authority: { source: authorId, weight: 1 }, uncertainty: { kind: 'unknown' }, access_scopes: scopes,
    render: 'exclude', training: 'exclude', provenance };
  const rootExists = nodes.has(search.understandingRootId);
  const addNodes = []; const addEdges = [];
  if (!rootExists) {
    addNodes.push({ ...common, id: search.understandingRootId, node_type: 'understanding_process_root', role: 'metadata',
      title: `Search understanding for ${search.searchRootId}`, subject: search.searchRootId,
      text: JSON.stringify({ name: `Search understanding for ${search.searchRootId}`, clock: 'search_step',
        purpose: 'Worlds, solves, compiled mechanisms, ontology revisions, commissions and transfers of this search.' }),
      epistemic_status: 'authored_process', evidence_type: 'creative_hypothesis' });
    addEdges.push({ id: `${search.understandingRootId}.search`, source: endpoint(search.understandingRootId), target: endpoint(search.searchRootId),
      family: 'semantic', relation: 'about', access_scopes: scopes, provenance });
  }
  for (const [index, record] of records.entries()) {
    const payload = { schema: RECORD_SCHEMA, kind: record.kind, data: record.data, ...(record.task ? { task: record.task } : {}),
      searchClock: { rootId: search.understandingRootId, unit: 'search_step', at: search.step, index } };
    const reflection = REFLECTION_KINDS.has(record.kind);
    addNodes.push({ ...common, id: record.nodeId, node_type: `alien.${record.kind}`, role: reflection ? 'externalized_reflection' : 'metadata',
      title: record.title ?? null, text: JSON.stringify(payload),
      epistemic_status: record.epistemicStatus ?? (reflection ? 'construction_decision' : 'authored_proposal'),
      evidence_type: record.evidenceType ?? 'creative_hypothesis', holder: authorId, subject: search.searchRootId, value_time: search.step });
    const edge = (suffix, target, family, relation, extra = {}) => ({ id: `${record.nodeId}.${suffix}`, source: endpoint(record.nodeId), target,
      family, relation, access_scopes: scopes, provenance, ...extra });
    // Sibling order comes from the revision this batch creates, so it never collides with a record written at search start.
    addEdges.push({ id: `${record.nodeId}.placement`, source: endpoint(search.understandingRootId), target: endpoint(record.nodeId),
      family: 'structural', relation: 'contains', order: (search.step + 1) * 16 + index, access_scopes: scopes, provenance });
    addEdges.push(edge('search', endpoint(search.searchRootId), 'semantic', 'about'));
    for (const [linkIndex, link] of (record.links ?? []).entries()) addEdges.push(edge(`link.${linkIndex}`, endpoint(link.targetNodeId), link.family ?? 'semantic', link.relation));
    for (const [anchorIndex, anchor] of (record.anchors ?? []).entries()) {
      addEdges.push(edge(`anchor.${anchorIndex}`, { kind: 'anchor', anchor_kind: anchor.anchorKind, anchor_id: anchor.anchorId }, 'grounding', anchor.relation,
        anchor.explanation ? { explanation: anchor.explanation } : {}));
    }
  }
  const stored = await service.applyNarrativeBatch({ requestId, previousGraphHash: search.view.graph_hash,
    narrativeBatch: { schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: search.view.graph_hash, reason, provenance,
      add_roots: rootExists ? [] : [search.understandingRootId], add_nodes: addNodes, add_edges: addEdges } });
  return { stored, scopes };
}
