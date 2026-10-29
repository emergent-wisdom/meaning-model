// Verifying candidates with PURE and Fractal Intelligence, as Sema defines them. PURECheck (PURECheck#574b) judges one
// candidate on four axes: Parsimony, Novelty, Realizable and Expansive. Each axis is judged in its own context without
// sight of the others' verdicts, and the result is non-compensatory: verified only when every axis is verified
// (PURE#b65a). Each axis is also a decomposition point: its question opens into probes, each answered the same way, as
// Fractal Intelligence decomposes a problem into parts (FractalIntelligence#1dca), and the probes compose into the
// axis's status by the axis's own rule. How deep each axis goes is Fractal Intelligence's call, by its marginal-value
// rule (MarginalValueRule#6611): deepen where the answer is uncertain and would change the verdict, stop where another
// level would change nothing. A probe that needs a fresh look opens as its own verification, a sub-solver in its own
// context, recursively, with no fixed depth; its status stands in for the probe it opened, and the axis composes again.
// The server computes the result from the axes' records; nobody authors it. A verdict is a model-judged screening of an
// idea, not evidence that it works.
export const PURE_AXES = Object.freeze(['parsimony', 'novelty', 'realizable', 'expansive']);
export const PURE_STATUSES = Object.freeze(['verified', 'falsified', 'unknown']);
// The exact cards a verification applied, stored on each record so a later card revision cannot change what it meant.
// Candidates are MechanisticDesignProposals (MechanisticDesignProposal#930a), the nine-field schema of the study.
export const PURE_CARDS = Object.freeze({ check: 'PURECheck#574b', framework: 'PURE#b65a', parsimony: 'Parsimony#4df8',
  novelty: 'Novelty#954f', realizable: 'Realizable#2ed7', expansive: 'Expansive#49a7', fractal: 'FractalIntelligence#1dca',
  depth: 'MarginalValueRule#6611', proposal: 'MechanisticDesignProposal#930a' });
// Within one record probes may nest this deep; deeper than that, a probe opens as its own verification.
export const MAX_PROBE_DEPTH = 6;

// What each axis asks, how it is worked, what one probe is, how the probes decide the status, and the criterion. The
// texts restate the Sema cards, and the candidate's own MechanisticDesignProposal fields where an axis tests them, so
// a verifier in a fresh context needs no tools.
export const AXIS_TEXT = Object.freeze({
  parsimony: {
    name: 'Parsimony',
    question: 'Does the simplest form of this candidate still do its job?',
    method: 'State the job first. Then ablate along the causal chain its core_mechanism states: remove each role, part or step in turn, and remove together any parts that back each other up, asking each time whether the candidate still does the job. Look for a strictly simpler mechanism that would do the same job.',
    probes: 'one probe per part or set of parts removed, and one for the simplest alternative you can find: verified when the part is needed (removing it stops the candidate doing its job) or no simpler form does the job; falsified when the part can go without loss, or the simpler form does the job (name it).',
    rule: 'verified when every probe is verified, falsified when any probe is falsified, unknown otherwise.',
    criterion: 'verified when every part is needed and no simpler form is evident; falsified when a part can go without loss, or a strictly simpler mechanism does the same job; unknown when the description cannot settle it.',
  },
  novelty: {
    name: 'Novelty',
    question: 'Is its operative causal relation structurally new, or a rename or small variation of something that exists?',
    method: 'Compare its structure, not its words, against two references: the candidates this search found before it (listed below when there are any), and known practice, meaning anything people already do or have proposed, as far as you know. Its what_is_new names what it claims to improve on; test that claim, and look for the incumbents it leaves out, since a weak or outdated comparison overclaims novelty. Say which reference you judged against, and name the nearest incumbent either way.',
    probes: 'one probe per incumbent compared: verified when the candidate differs from it structurally, falsified when the candidate restates it or varies it slightly.',
    rule: 'verified when every probe is verified, falsified when any probe is falsified, unknown otherwise.',
    criterion: 'verified when its operative relation differs structurally from every earlier candidate of this search and every known practice you can name; falsified when it restates one of them (name it as the nearest); unknown when you cannot tell.',
  },
  realizable: {
    name: 'Realizable',
    question: 'Can it actually be built or enacted with present or near-term means, within a stated budget?',
    method: 'Name the budget you judge against: time, money, people and technology. Ground every role and step in a part that is itself realizable, recursively, until each leaf is something available now; list the parts in dependency order, so no step comes before what it needs, and open any part that is not plainly available into its own parts. The conditions its why_it_fails names are parts to ground too.',
    probes: 'one probe per part, in dependency order: verified when it can be built or done within the budget, falsified when it cannot (name what is missing); a part with parts holds when all of them do.',
    rule: 'verified when every probe is verified, falsified when any probe is falsified, unknown otherwise, at every level: a part that cannot be realized makes the whole unrealizable.',
    criterion: 'verified when every part is realizable within the budget; falsified when some part cannot be built or done (name it); unknown otherwise.',
  },
  expansive: {
    name: 'Expansive',
    question: 'Does it carry beyond the domain it was designed for?',
    method: 'Say what the candidate already proves in its own domain, and state the transfer hypothesis: what should carry over. Then try its operative relation in at least two domains deliberately unlike the problem\'s, and say what carries over and what breaks; do not argue from cases inside its own domain.',
    probes: 'one probe per domain tried, at least two: verified when the relation carries over there, falsified when it breaks there; inside a domain, one probe per part that has to carry over, and the domain holds only when all of them do.',
    rule: 'verified when any domain probe is verified, falsified when every domain probe is falsified, unknown otherwise; inside a domain, every part must hold.',
    criterion: 'verified when its operative relation carries over to a domain unlike its origin; falsified when it works only in its original setting; unknown otherwise.',
  },
});

// How the probes of one level compose into a status. Parsimony, Novelty and Realizable are conjunctive: every part
// needed, distinct from every incumbent, every part realizable. Expansive's first level is the domains tried, and it
// holds when the candidate carries over to any of them; inside a domain, every part must carry over.
const every = (statuses) => (statuses.includes('falsified') ? 'falsified' : statuses.every((status) => status === 'verified') ? 'verified' : 'unknown');
const some = (statuses) => (statuses.includes('verified') ? 'verified' : statuses.every((status) => status === 'falsified') ? 'falsified' : 'unknown');
export const composeStatus = (axis, statuses, level) => (axis === 'expansive' && level === 0 ? some : every)(statuses);

const depthOf = (probes) => (probes.length ? 1 + Math.max(...probes.map((probe) => depthOf(probe.probes ?? []))) : 0);
const samePath = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// The rules a verification record must keep, beyond its schema. level is where its probes sit in the axis's tree: 0
// for a check of the whole axis, deeper for a check opened from a probe. Wherever there are probes, the stated status
// is the one they compose to, so the decomposition decides the verdict and a doubt is written down as a probe.
export function checkVerification(data, level = 0) {
  if (depthOf(data.probes) > MAX_PROBE_DEPTH) throw new Error(`Probes nest at most ${MAX_PROBE_DEPTH} levels within one record; open a deeper probe as its own verification (a verifier task with deepen).`);
  if (data.axis === 'novelty' && data.status === 'falsified' && !data.nearest) throw new Error('A falsified novelty check names the nearest incumbent it restates.');
  if (data.axis === 'expansive' && level === 0 && data.status !== 'unknown' && data.probes.length < 2) {
    throw new Error('Expansive tries at least two domains unlike the problem\'s, one probe each, before it is verified or falsified.');
  }
  const text = AXIS_TEXT[data.axis];
  // Deepest first, so the message points at the probe where the statuses part ways.
  const check = (node, childLevel, path) => {
    if (!node.probes?.length) return;
    node.probes.forEach((probe, index) => check(probe, childLevel + 1, [...path, index]));
    const composed = composeStatus(data.axis, node.probes.map((probe) => probe.status), childLevel);
    if (node.status !== composed) {
      throw new Error(`${text.name} follows from its probes: ${text.rule} ${path.length ? `Probe [${path.join(', ')}]` : 'The check'} says ${node.status}, and its probes give ${composed}. Record ${composed}, or add a probe for the doubt that remains.`);
    }
  };
  check(data, level, []);
}

// The cards a record applied: PURECheck and PURE, its axis, and Fractal Intelligence when the axis opened into probes.
export const cardsFor = (data) => [PURE_CARDS.check, PURE_CARDS.framework, PURE_CARDS[data.axis],
  ...(data.probes.length || data.deepens ? [PURE_CARDS.fractal, PURE_CARDS.depth] : [])];

// The probe a path names inside a record's probes: [2, 0] is the first sub-probe of the third probe.
export function probeAt(probes, path) {
  let list = probes; let probe = null;
  for (const index of path) {
    probe = list?.[index];
    if (!probe) return null;
    list = probe.probes ?? [];
  }
  return probe;
}

// Where a record's probes sit in its axis's tree: 0 for a check of the whole axis; a deeper check's probes sit below
// the probe it opened.
export function levelOf(record, byNodeId) {
  let level = 0; let current = record; const seen = new Set();
  while (current?.data.deepens && !seen.has(current.nodeId)) {
    seen.add(current.nodeId);
    level += current.data.deepens.probePath.length;
    current = byNodeId.get(current.data.deepens.verificationNodeId);
  }
  return level;
}

// The status of a check with the deeper checks opened from it: the latest deeper check of a probe stands in for that
// probe and everything below it, and the probes compose again by the axis rule, level by level.
function effectiveStatus(record, level, opened, onRefinement = null) {
  const children = opened.get(record.nodeId) ?? [];
  const refine = (probes, path, probeLevel) => probes.map((probe, index) => {
    const at = [...path, index];
    const deeper = children.filter((item) => samePath(item.data.deepens.probePath, at)).at(-1);
    if (deeper) {
      const status = effectiveStatus(deeper, level + at.length, opened, onRefinement);
      onRefinement?.(deeper, status);
      return status;
    }
    if (probe.probes?.length) return composeStatus(record.data.axis, refine(probe.probes, at, probeLevel + 1), probeLevel + 1);
    return probe.status;
  });
  if (!record.data.probes.length) return record.data.status;
  return composeStatus(record.data.axis, refine(record.data.probes, [], level), level);
}

function refinementsByParent(records) {
  const opened = new Map();
  for (const record of records) {
    if (!record.data.deepens) continue;
    const parent = record.data.deepens.verificationNodeId;
    opened.set(parent, [...(opened.get(parent) ?? []), record]);
  }
  return opened;
}

// The PURE result of one subject. Each axis reads its latest check of the whole axis, refined by the deeper checks
// opened from it (deeper checks of an earlier, superseded check do not count). The result is verified when all four
// axes are verified, falsified when any is falsified, unknown otherwise; missing axes count as unknown and are listed.
export function pureResult(search, subjectNodeId) {
  const records = (search.verifications ?? []).filter((record) => record.data.subjectNodeId === subjectNodeId);
  const opened = refinementsByParent(records);
  const axes = {};
  for (const axis of PURE_AXES) {
    const root = records.filter((record) => record.data.axis === axis && !record.data.deepens).at(-1);
    if (root) axes[axis] = { status: effectiveStatus(root, 0, opened), stated: root.data.status, nodeId: root.nodeId };
  }
  const missing = PURE_AXES.filter((axis) => !axes[axis]);
  const statuses = PURE_AXES.map((axis) => axes[axis]?.status ?? 'unknown');
  const status = statuses.includes('falsified') ? 'falsified' : statuses.every((value) => value === 'verified') ? 'verified' : 'unknown';
  return { subjectNodeId, status, axes, missing };
}

// Every candidate a verification names, with its result; the candidates selected or transferred with no full check;
// how deep each axis went; and where a deeper check changed the probe it opened.
export function verificationSummary(search) {
  const verifications = search.verifications ?? [];
  const subjects = [...new Set(verifications.map((record) => record.data.subjectNodeId))];
  const results = subjects.map((subjectNodeId) => pureResult(search, subjectNodeId));
  const checked = new Set(results.filter((result) => !result.missing.length).map((result) => result.subjectNodeId));
  const selected = [...new Set((search.selections ?? []).flatMap((selection) => selection.data.items.map((item) => item.nodeId)))];
  const byNodeId = new Map(verifications.map((record) => [record.nodeId, record]));
  const opened = refinementsByParent(verifications);
  const activeStatuses = new Map();
  // Walk exactly the refinements that the current result uses, so an older root, older check of the same probe or
  // replaced subtree cannot produce a warning claiming that it still changes the axis. Include later deepening.
  for (const result of results) for (const axis of Object.values(result.axes)) {
    effectiveStatus(byNodeId.get(axis.nodeId), 0, opened, (record, status) => activeStatuses.set(record.nodeId, status));
  }
  const changed = verifications.filter((record) => activeStatuses.has(record.nodeId)).map((record) => {
    const parent = byNodeId.get(record.data.deepens.verificationNodeId);
    const probe = parent ? probeAt(parent.data.probes, record.data.deepens.probePath) : null;
    const deeperStatus = activeStatuses.get(record.nodeId);
    return probe && probe.status !== deeperStatus
      ? { verificationNodeId: record.nodeId, deepens: parent.nodeId, subjectNodeId: record.data.subjectNodeId, probePath: record.data.deepens.probePath, axis: record.data.axis, probeStatus: probe.status, deeperStatus }
      : null;
  }).filter(Boolean);
  const chain = (record) => { let count = 0; let current = record; const seen = new Set();
    while (current?.data.deepens && !seen.has(current.nodeId)) { seen.add(current.nodeId); count += 1; current = byNodeId.get(current.data.deepens.verificationNodeId); }
    return count; };
  const depth = {};
  for (const record of verifications) {
    const key = `${record.data.subjectNodeId}\u0000${record.data.axis}`;
    depth[key] = Math.max(depth[key] ?? 0, chain(record));
  }
  return {
    results,
    verified: results.filter((result) => result.status === 'verified').map((result) => result.subjectNodeId),
    falsified: results.filter((result) => result.status === 'falsified').map((result) => result.subjectNodeId),
    incomplete: results.filter((result) => result.missing.length && result.status !== 'falsified').map((result) => ({ subjectNodeId: result.subjectNodeId, missing: result.missing })),
    unverifiedTransfers: (search.transfers ?? []).map((item) => item.nodeId).filter((nodeId) => !checked.has(nodeId) && !results.some((result) => result.subjectNodeId === nodeId && result.status === 'falsified')),
    unverifiedSelections: selected.filter((nodeId) => !checked.has(nodeId)),
    deepened: Object.entries(depth).filter(([, value]) => value > 0).map(([key, value]) => { const [subjectNodeId, axis] = key.split('\u0000'); return { subjectNodeId, axis, levels: value }; }),
    changed,
  };
}
