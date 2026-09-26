// Lenses: ways of seeing, found and defined by the modeler, and asked of the model.
//
// A lens is a question that can be asked of many records: whether an act comes from fear or from love, whether a
// person is wanting, bartering or standing for something, whether a trade hedges or speculates. There are as many
// lenses as there are ways to understand what people and worlds do, and most of them are not in any list: the
// modeler looks for them in thinkers, traditions, disciplines, the story itself, and invents the ones this world needs.
//
// A lens is an Understanding Node of kind `lens`, so it is part of the record and replays with the construction. Its
// data names the question, the kinds of record it is asked of, and its answers, or none when the answers are the
// modeler's to find case by case. Each answer is a Cut on the record's Event, with an id that begins
// `lens.<lens id>.`, so every lens's answers are weighted, keep a remainder, can be estimated and drawn, and are read
// the same way by every tool and view. The engine needs nothing new.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { recordUnderstanding, targetSchema } from './construction-record.mjs';
import { resolveAppendHead } from './graph-head.mjs';
import { rebindNarrativeGraph } from './narrative-rebind.mjs';
import { constructionNoteIn, eventTextSignature, proposeCutShares } from './cut-shares.mjs';
import { READING_MARK, contextKindOf, cutKind, eventDescendants, indexModel, modeledPeople, readDraws, readPerson, storyProfile } from './model-questions.mjs';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeList = z.array(id).min(1).max(64);
export const LENS_KINDS = Object.freeze(['act', 'period', 'life', 'event', 'inner']);
export const LENS_SCHEMA = 'meaning-model-lens/v1';

// The one lens every story starts with, when the storytelling profile is adopted: general modeling has no built-in
// lens. Defining a lens with this id replaces it.
export const BUILT_IN_LENSES = Object.freeze([{
  id: 'fear-love', name: 'Fear or love', builtIn: true, appliesTo: ['act'],
  question: 'What kinds of reasons lie behind {subject}: is it primarily out of fear or out of love, and what does that fear or love ask of the person?',
  why: 'The same act can come from fear or from love, and what it does to the person and to the people around them depends on which.',
  answers: null, trajectory: 'A life that moves from acting out of fear to acting out of love, or back, has changed at its root.',
  // Its answers are found case by case (love of what, fear of what), and are compared by their family: an answer in
  // neither family compares as other.
  families: { love: ['love'], fear: ['fear'] },
  // Before lenses had ids, this lens's answers were Cuts that asked it in their own words.
  matchesQuestion: /\bfear\b[^?]*\blove\b|\blove\b[^?]*\bfear\b/iu,
}]);

// A lens version's signature: its question, the records it is asked of and its answers with their meanings. An answer
// carries it in its unit (lens:<id>@<signature>), so an answer given to another question is known for what it is.
export function lensSignature(lens) {
  const answers = (lens.answers ?? []).map((answer) => [answer.key, answer.meaning]).sort((a, b) => a[0].localeCompare(b[0]));
  // The positions of retired fields (a reader, an evidence policy) are kept at their defaults, so signatures stand.
  const perspective = [lens.perspective ?? 'modeler', null, lens.reading ?? 'support', lens.unitMeaning ?? null, 'model'];
  return createHash('sha256').update(JSON.stringify({ question: lens.question, appliesTo: [...lens.appliesTo].sort(), answers, ...(perspective.some((item, i) => item !== [ 'modeler', null, 'support', null, 'model' ][i]) ? { perspective } : {}) })).digest('hex').slice(0, 16);
}
export const lensUnit = (lens) => `lens:${lens.id}@${lensSignature(lens)}`;

// ---- opening a reading, level by level ------------------------------------------------------------------------
// A reading opens as the theory's Cut hierarchy does: one reading Event, a Cut at the top, and for an answer opened
// into its kinds a Cut conditioned on that answer, on the same Event, with a remainder at every level. Shares down a
// path multiply into joint shares of the whole unit, so answers at different depths can be measured against each other,
// and each level is versioned by itself, so opening deeper leaves the levels above valid.
export const answerAt = (lens, path) => { let answers = lens.answers ?? null; let node = null;
  for (const key of path) { node = (answers ?? []).find((answer) => answer.key === key) ?? null; if (!node) return null; answers = node.children ?? null; } return node; };
export function levelSignature(lens, path) {
  const node = answerAt(lens, path);
  const children = node?.children ? node.children.map((child) => [child.key, child.meaning]).sort((a, b) => a[0].localeCompare(b[0])) : null;
  return createHash('sha256').update(JSON.stringify({ path, question: node?.question ?? null, children })).digest('hex').slice(0, 16);
}
export const levelUnit = (lens, path) => `lens:${lens.id}/${path.join('/')}@${levelSignature(lens, path)}`;
export const childCutId = (parentCutId, key) => `${parentCutId}.in.${key}`;
const levelQuestion = (lens, path, subject) => {
  const key = path.at(-1); const node = answerAt(lens, path);
  if (node?.question) return node.question.includes('{subject}') ? node.question.replaceAll('{subject}', phrase(subject)) : `${node.question} (${phrase(subject)})`;
  return key === 'remainder' ? `Beyond the answers named, what else lies behind ${phrase(subject)}, and in what share?`
    : `Within the "${key}" behind ${phrase(subject)}: which kinds of ${key.replace(/[_-]+/gu, ' ')} is it, and in what share?`;
};
// The opened levels of one reading: each conditional Cut with its path, the joint mass of the answer it divides and its
// shares, and the joint share of every leaf. A remainder inside an answer is still that answer; an unopened answer has
// no remainder inside it, its kinds are unmodeled.
function readingTree(lens, top, cutsOnEvent) {
  const children = new Map();
  for (const cut of cutsOnEvent) if (cut.conditioning?.cut_id && String(cut.id).startsWith(`lens.${lens.id}.`)) { if (!children.has(cut.conditioning.cut_id)) children.set(cut.conditioning.cut_id, []); children.get(cut.conditioning.cut_id).push(cut); }
  const opened = []; const joint = {};
  const walk = (cut, path, mass) => {
    for (const answer of cut.answers ?? []) {
      const share = mass * answer.weight; const here = [...path, answer.key];
      const child = (children.get(cut.id) ?? []).find((item) => item.conditioning.answer_key === answer.key);
      if (child && here.length <= MAX_LENS_DEPTH * 2) {
        const fixed = Boolean(answerAt(lens, here)?.children);
        opened.push({ path: here, cutId: child.id, mass: +share.toFixed(4), shares: Object.fromEntries((child.answers ?? []).map((item) => [item.key, +item.weight.toFixed(4)])),
          fixed, ...(fixed && child.unit !== levelUnit(lens, here) ? { stale: 'it answers another version of this level' } : {}) });
        walk(child, here, share);
      } else joint[here.join('/')] = +share.toFixed(4);
    }
  };
  walk(top, [], 1);
  return { opened, joint };
}
// A decision to stop opening is recorded, as a decline is: an Understanding Node about the record's Event with data
// { schema: meaning-model-lens-sufficiency/v1, lensId, path, reason, reopenIf }.
export const LENS_SUFFICIENCY_SCHEMA = 'meaning-model-lens-sufficiency/v1';
function readSufficiency(view) {
  const stops = new Map(); const about = new Map();
  for (const edge of view?.edges ?? []) if (edge.source?.kind === 'node' && edge.relation === 'about' && edge.target?.kind === 'anchor' && edge.target.anchor_kind === 'event') { if (!about.has(edge.source.node_id)) about.set(edge.source.node_id, []); about.get(edge.source.node_id).push(edge.target.anchor_id); }
  for (const node of view?.nodes ?? []) {
    if (!String(node.node_type ?? '').startsWith('understanding.')) continue;
    let data = null; try { data = JSON.parse(node.text)?.data; } catch { continue; }
    if (data?.schema !== LENS_SUFFICIENCY_SCHEMA || !data.lensId || !Array.isArray(data.path)) continue;
    for (const eventId of about.get(node.id) ?? []) stops.set(`${data.lensId}|${eventId}|${data.path.join('/')}`, { nodeId: node.id, reason: data.reason ?? null, reopenIf: data.reopenIf ?? null });
  }
  return stops;
}
export const OPEN_AT = 0.3;
// An answer and, when the lens fixes them, the kinds it opens into: fear, then fear of what. Each level keeps a remainder.
const answerSchema = z.lazy(() => z.object({
  key: id, meaning: z.string().trim().min(1).max(600),
  concept: id.optional().describe('The model\'s Concept for this answer, when it has one: a kind of its parent answer\'s Concept.'),
  question: z.string().trim().min(8).max(800).optional().describe('The question that opens this answer, as "What is the fear of?"'),
  children: z.array(answerSchema).min(2).max(32).optional().describe('The kinds this answer opens into. Leave them out to find them case by case.'),
}).strict());
const treeDepth = (answers, depth = 1) => Math.max(depth, ...(answers ?? []).map((answer) => (answer.children ? treeDepth(answer.children, depth + 1) : depth)));
// Opening has no conceptual ceiling. The questions suggest openings down to a default limit, reported as a limit and
// raised with maxDepth; this bound only keeps a runaway definition finite.
export const MAX_LENS_DEPTH = 64;
export const DEFAULT_OPEN_DEPTH = 4;

export const lensDefineSchema = z.object({
  graphHash: hash, requestId: id, accessScopes: scopeList,
  exactRevision: z.boolean().default(false).describe('Write against graphHash exactly, creating a branch if it is not the newest revision.'),
  holder: id.describe('Who holds this way of seeing: usually the modeler.'), recordedBy: id.optional(),
  lens: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/u).describe('A short id: lowercase letters, digits and hyphens. Answers are Cuts whose ids begin lens.<id>.'),
    name: z.string().trim().min(1).max(160),
    question: z.string().trim().min(8).max(800).describe('The question asked of each record. {subject} stands for the record, as in "Is {subject} done out of wanting, bartering for a reaction, or standing for something regardless of approval?"'),
    appliesTo: z.array(z.enum(LENS_KINDS)).min(1).max(LENS_KINDS.length).describe('act: every moment where a person chooses (an Event with a decision Cut); period: every period of a life; life: each whole life; event: the Events named in about; inner: what a person thinks, feels or tells themselves (the Events under their inner root), read as the modeler\'s interpretation of theirs and compared only with other inner records.'),
    answers: z.array(answerSchema).min(2).max(32).optional()
      .describe('The answers the lens distinguishes, when it has them. Leave them out when the answers are to be found case by case. Every answer Cut also keeps a remainder for what the lens does not name. An answer may have children, the kinds it opens into, and they theirs: a reading is then opened level by level, each level a Cut conditioned on the answer it divides.'),
    why: z.string().trim().min(8).max(4_000).describe('What this lens can reveal here that the others cannot: what it would change in the model if it were true.'),
    source: z.string().trim().min(1).max(1_000).optional().describe('Where the way of seeing comes from: a thinker, a tradition, a discipline, a conversation, or this world itself.'),
    trajectory: z.string().trim().min(1).max(1_000).optional().describe('What it would mean for a person\'s answer to change over their life, or never to change.'),
    perspective: z.enum(['modeler', 'actor']).default('modeler').describe('Whose reading this is. modeler: the modeler\'s interpretation, held under their understanding root. actor: the actor\'s own reasons as canon, on an inner Event under the actor\'s inner root, placed at the decision. A lens keeps its perspective across its versions: a different holder is a different lens.'),
    reading: z.enum(['allocation', 'support']).default('support').describe('What a reading is. allocation: how the reasons behind the record divide among the answers (declare how shared reasons are assigned, for example a joint answer). support: which answers the evidence supports; an estimator\'s output is support. Answers that co-occur (an act can be a quarrel and a farewell at once) are a joint answer, or separate lenses.'),
    unitMeaning: z.string().trim().min(3).max(600).optional().describe('What one unit of a reading is, in words: explanatory responsibility, attention, a comparison budget or evidential support.'),
    families: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/u), z.array(z.string().trim().min(1).max(64)).min(1).max(16)).optional().describe('For a lens whose answers are found case by case: families that group them for comparison, each a list of key prefixes, as fear or love groups love_of_... and fear_of_.... A key in no family compares as other.'),
    status: z.enum(['authored', 'adopted', 'candidate', 'tested']).default('authored').describe('What the lens is claimed to be: an authored way of seeing, an adopted framework, a candidate explanation, or one tested against held-out evidence. Its why and trajectory are hypotheses until tested.'),
  }).strict(),
  about: z.array(targetSchema).max(32).default([]).describe('Who or what the lens looks at: the people, Events or processes it is for. For act, period and life it is asked of the people named here, or of every principal when none is.'),
}).strict();

export async function defineLens(service, raw) {
  const input = lensDefineSchema.parse(raw);
  const { lens } = input;
  if (treeDepth(lens.answers) > MAX_LENS_DEPTH) throw new Error(`A lens's answers are nested more than ${MAX_LENS_DEPTH} levels, which is taken for a runaway definition.`);
  // Defining a lens again revises it: the new version supersedes the one before. The versions are read at the head
  // the record will be written to (the newest, or the base of a retried request), so a stale hash cannot pick a taken id.
  const head = await resolveAppendHead(service, input.graphHash, input.requestId, input.exactRevision);
  const view = await service.queryNarrativeGraph({ graphHash: head.graphHash, expectedGraphHash: head.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.accessScopes)].sort() });
  const versions = readLensNodes(view).filter((node) => node.data.id === lens.id);
  const current = versions.find((node) => !node.superseded) ?? null;
  if (current && (current.data.perspective ?? 'modeler') !== (lens.perspective ?? 'modeler')) throw new Error(`The lens ${lens.id} reads from the ${current.data.perspective ?? 'modeler'}'s perspective, and a lens keeps its perspective across its versions: a different holder is a different lens. Define it under a new id.`);
  const nodeId = current ? `lens.${lens.id}.r${versions.length + 1}` : `lens.${lens.id}`;
  const text = `${lens.name}. ${lens.question}\n\nWhy: ${lens.why}${lens.source ? `\n\nSource: ${lens.source}` : ''}${lens.trajectory ? `\n\nOver a life: ${lens.trajectory}` : ''}`;
  const recorded = await recordUnderstanding(service, {
    graphHash: head.graphHash, requestId: input.requestId, accessScopes: input.accessScopes, exactRevision: true,
    holder: input.holder, ...(input.recordedBy ? { recordedBy: input.recordedBy } : {}),
    // A lens that names no one in particular looks at the whole work: its note is about the graph's root.
    notes: [{ nodeId, kind: 'lens', title: lens.name, text, about: input.about.length ? input.about : (view.roots ?? view.graph?.roots ?? []).slice(0, 1).map((root) => ({ nodeId: root })), links: current ? [{ relation: 'supersedes', targetNodeId: current.nodeId }] : [], data: { schema: LENS_SCHEMA, ...lens } }],
  });
  const kindWords = /\b(want\w*|feel\w*|feeling|expect\w*|outlook|threat\w*|health|decid\w*|decision)\b/iu;
  const collisions = (lens.answers ?? []).filter((answer) => kindWords.test(answer.key.replace(/[_-]+/gu, ' ')));
  const warnings = collisions.map((answer) => `The answer "${answer.key}" shares a word with the model's own Cuts (what people want, feel, expect or decide), so an estimator told the modeled state may read, say, having wants as this answer. A key no Cut uses, with its meaning spelled out, reads cleaner.`);
  return { ...recorded, ...(head.advancedFrom ? { advancedFrom: head.advancedFrom } : {}), ...(warnings.length ? { warnings } : {}), schema: 'meaning-model-lens-definition/v1', lensId: lens.id, lensNodeId: nodeId, version: versions.length + 1, unit: lensUnit(lens), ...(current ? { supersedes: current.nodeId } : {}),
    nextStep: `life_lens_questions asks "${lens.name}" of every record it applies to. Answer each as a Cut on the record's Event, with an id that begins lens.${lens.id}. and the unit ${lensUnit(lens)}, then keep looking: which other lenses would see what this one cannot?` };
}

// ---------------------------------------------------------------------------------------------
// Asking the lenses of the model.

const clip = (text, n) => { const value = String(text ?? '').replace(/\s+/gu, ' ').trim(); return value.length > n ? `${value.slice(0, n - 1)}…` : value; };
const labelOf = (event) => clip(event?.boundary ?? event?.description ?? event?.id, 140);
const startOf = (event) => (Number.isFinite(event?.interval?.start) ? event.interval.start : null);
// A person's name as the model states it, the lead of the referent's boundary, else the id's last part.
const nameOf = (index, person) => {
  const boundary = String(index.referents.get(person.id)?.boundary ?? ''); const lead = boundary.split(/[,;(]| - | — /u)[0].trim();
  return lead && lead.split(/\s+/u).length <= 4 && /^\p{Lu}/u.test(lead) ? lead.replace(/^(the|a) /iu, '') : person.name;
};
// The question a lens asks of one record.
const questionFor = (lens, subject) => (lens.question.includes('{subject}') ? lens.question.replaceAll('{subject}', phrase(subject)) : `${lens.question} (${phrase(subject)})`);
// How a record reads inside a lens's question.
const phrase = (subject) => {
  const label = `"${subject.label.replace(/[.\s]+$/u, '')}"`;
  if (subject.kind === 'act') return `what ${subject.person} does at ${label}`;
  if (subject.kind === 'period') return `how ${subject.person} lives through ${label}`;
  if (subject.kind === 'life') return `${subject.person}'s life`;
  if (subject.kind === 'arc' && subject.person) return `how ${subject.person} goes through ${label}`;
  return label;
};

// Every lens node in the graph, marking the versions a later one supersedes.
function readLensNodes(view) {
  const nodes = [];
  for (const node of view?.nodes ?? []) {
    if (node.node_type !== 'understanding.lens') continue;
    try { const data = JSON.parse(node.text)?.data; if (data?.schema === LENS_SCHEMA) nodes.push({ nodeId: node.id, data, holder: node.holder ?? null, writtenAgainst: (node.provenance ?? []).find((item) => String(item).startsWith('written-against-model:'))?.slice(22) ?? null }); } catch { /* not a lens payload */ }
  }
  const ids = new Set(nodes.map((node) => node.nodeId));
  const superseded = new Set((view?.edges ?? []).filter((edge) => edge.relation === 'supersedes' && ids.has(edge.source?.node_id) && edge.target?.kind === 'node').map((edge) => edge.target.node_id));
  return nodes.map((node) => ({ ...node, superseded: superseded.has(node.nodeId) }));
}

// A record a lens does not fit is declined with a note (an Understanding Node about the record's Event, with data
// { schema: meaning-model-lens-decline/v1, lensId, reason }), not answered with a number.
export const LENS_DECLINE_SCHEMA = 'meaning-model-lens-decline/v1';
function readDeclines(view) {
  const declined = new Map();
  const noteAbout = new Map();
  for (const edge of view?.edges ?? []) if (edge.source?.kind === 'node' && edge.relation === 'about' && edge.target?.kind === 'anchor' && edge.target.anchor_kind === 'event') {
    if (!noteAbout.has(edge.source.node_id)) noteAbout.set(edge.source.node_id, []); noteAbout.get(edge.source.node_id).push(edge.target.anchor_id);
  }
  for (const node of view?.nodes ?? []) {
    if (!String(node.node_type ?? '').startsWith('understanding.')) continue;
    let data = null; try { data = JSON.parse(node.text)?.data; } catch { continue; }
    if (data?.schema !== LENS_DECLINE_SCHEMA || !data.lensId) continue;
    for (const eventId of noteAbout.get(node.id) ?? []) { if (!declined.has(data.lensId)) declined.set(data.lensId, new Map()); declined.get(data.lensId).set(eventId, { nodeId: node.id, reason: data.reason ?? null }); }
  }
  return declined;
}

export function readLenses(view) {
  const nodes = readLensNodes(view);
  const defined = nodes.filter((node) => !node.superseded).map((node) => ({ ...node.data, nodeId: node.nodeId, builtIn: false, holder: node.holder,
    version: nodes.filter((other) => other.data.id === node.data.id).length, writtenAgainst: node.writtenAgainst }));
  const about = new Map();
  for (const edge of view?.edges ?? []) {
    if (edge.source?.kind !== 'node' || edge.relation !== 'about' || edge.target?.kind !== 'anchor') continue;
    if (!about.has(edge.source.node_id)) about.set(edge.source.node_id, []);
    about.get(edge.source.node_id).push({ kind: edge.target.anchor_kind, id: edge.target.anchor_id });
  }
  // A lens defined with a built-in's id replaces it, and keeps what the built-in declares that it does not: fear or love
  // redefined with children keeps its families and still finds the answers asked in their own words.
  const inherit = (lens) => { const built = BUILT_IN_LENSES.find((item) => item.id === lens.id); if (!built) return lens;
    return { ...lens, families: lens.families ?? built.families, matchesQuestion: lens.matchesQuestion ?? built.matchesQuestion, trajectory: lens.trajectory ?? built.trajectory }; };
  const builtIn = storyProfile() ? BUILT_IN_LENSES : [];
  const lenses = [...builtIn.filter((lens) => !defined.some((item) => item.id === lens.id)), ...defined.map(inherit)];
  return lenses.map((lens) => ({ ...lens, about: lens.nodeId ? about.get(lens.nodeId) ?? [] : [] }));
}

// ---- where a reading belongs --------------------------------------------------------------------------------
// A reading is held by someone, so it sits beneath them, not on the record: the modeler's and an outside evaluator's
// under their understanding root, a character's under that character's inner root, and an actor's own reasons as canon
// on an inner Event of theirs at the decision. It links to the record by about, and the Cut is parented on it.
const holderSlug = (text) => String(text ?? 'modeler').toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'modeler';
export const understandingRootId = (holder) => `understanding.${holderSlug(holder)}`;
const isAbout = (relation) => relation.kind === 'about' || (relation.kind === 'other' && /^about\b/iu.test(String(relation.description ?? '')));
function innerRootOf(index, roots, personId) {
  const inner = roots.filter((root) => root.kind === 'inner').map((root) => root.event_id);
  const life = index.referents.get(personId)?.lifecycle_event_id ?? null;
  return inner.find((id) => [index.events.get(id)?.participants?.subject].flat().includes(personId))
    ?? inner.find((id) => { let at = id; for (let step = 0; step < 32 && at; step += 1) { if (at === life) return true; at = [...(index.parents.get(at) ?? [])][0]; } return false; }) ?? null;
}
function placementOf(lens, subject, index, roots, holder) {
  const perspective = lens.perspective ?? 'modeler';
  const record = subject.eventId;
  if (perspective === 'actor') {
    const personId = subject.personId;
    const root = personId ? innerRootOf(index, roots, personId) : null;
    // The actor's reasons are held at the decision.
    const decidedAt = subject.also?.[0] ?? null;
    const at = index.events.get(decidedAt ?? record)?.interval ?? null;
    return { perspective, rootKind: 'inner', root, rootExists: Boolean(root), eventId: `inner.${lens.id}.${record}`, about: record, person: personId, ...(decidedAt ? { decidedAt } : {}), ...(at ? { interval: at } : {}) };
  }
  const root = understandingRootId(holder);
  return { perspective, rootKind: 'understanding', root, rootExists: roots.some((item) => item.event_id === root), eventId: `reading.${lens.id}.${record}`, about: record };
}

// An act belongs to the person who decides it: the Event's subject, when the Event names one.
const decides = (event, personId) => { const subject = event?.participants?.subject; return !subject || (Array.isArray(subject) ? subject.includes(personId) : subject === personId); };

// Every record a lens is asked of, with its answer if there is one, and the moments it might also fit.
// A lens on acts asks of every drawn decision, through what was then done where the model holds it (the realized
// continuation), of the acts its about names, and of any moment already answered under it. The other moments a
// person is the subject of are candidates: the model does not say which are acts and which merely happen to them,
// so the modeler decides, and answering a candidate makes it one of the lens's records. Periods are the stretches of
// a life, not its change arcs. An answer on a drawn decision still answers what was done after it.
const subjectIs = (event, personId) => { const subject = event?.participants?.subject; return Boolean(subject) && (Array.isArray(subject) ? subject.includes(personId) : subject === personId); };
const spanOf = (event) => (Number.isFinite(event?.interval?.start) && Number.isFinite(event?.interval?.end) ? event.interval.end - event.interval.start : null);
const structural = (event) => /\.inner$/u.test(event.id) || /inner perspective root/iu.test(String(event.boundary ?? ''));
function subjectsOf(lens, index, people, before = null, declines = new Map(), place = { roots: [], holder: null }) {
  const named = lens.about.filter((target) => target.kind === 'referent').map((target) => target.id);
  const persons = named.length ? people.filter((person) => named.includes(person.id)) : people.filter((person) => person.principal);
  const subjects = new Map(); const candidates = new Map();
  const principals = people.filter((person) => person.principal);
  const others = (event, person) => principals.filter((other) => other.id !== person?.id && Object.values(event.participants ?? {}).flat().includes(other.id)).map((other) => nameOf(index, other));
  const entry = (event, kind, person, also = []) => ({ eventId: event.id, kind, person: person ? nameOf(index, person) : null, personId: person?.id ?? null, label: labelOf(event), t: startOf(event), end: Number.isFinite(event?.interval?.end) ? event.interval.end : null, also,
    sharedWith: kind === 'act' ? others(event, person) : [], note: constructionNoteIn(event.description) });
  const add = (event, kind, person, also = []) => { if (event && !subjects.has(event.id)) { subjects.set(event.id, entry(event, kind, person, also)); candidates.delete(event.id); } };
  // Readings reach their record through about; a reading parented on the record itself is in the world and awaits placement.
  const readsOf = new Map(); const readOf = new Map();
  for (const relation of index.relations ?? []) if (isAbout(relation) && index.readings?.has(relation.source_event_id)) { if (!readsOf.has(relation.target_event_id)) readsOf.set(relation.target_event_id, []); readsOf.get(relation.target_event_id).push(relation.source_event_id); readOf.set(relation.source_event_id, relation.target_event_id); }
  const answeredEvents = new Set((index.cuts ?? []).filter((cut) => String(cut.id).startsWith(`lens.${lens.id}.`)).map((cut) => readOf.get(cut.parent_event_id) ?? cut.parent_event_id));
  const aboutEvents = new Set(lens.about.filter((target) => target.kind === 'event').map((target) => target.id));
  // Only the world's Events are offered as acts: an Event beneath an inner root is what a person thinks or feels (an
  // appraisal), and one beneath an understanding, document or candidate root is not in the world at all.
  const notActs = new Set(['inner', 'understanding', 'document', 'candidate']);
  // Direction Cuts are never readings: a decision's continuations, a forecast a relation names, a drawn Cut, or one the
  // modeler has said is a direction Cut.
  const forecastCuts = new Set((index.relations ?? []).filter((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id).map((relation) => relation.forecast_answer.cut_id));
  const direction = (cut) => cutKind(cut) === 'decision' || forecastCuts.has(cut.id) || Boolean(place.drawn?.has(cut.id)) || (cut.provenance ?? []).includes('lens-resolved:direction');
  // A placed reading counts for this lens when it has this lens's holder: the same perspective.
  const perspectiveOf = (eventId) => (index.events.get(eventId)?.provenance ?? []).map((item) => /^perspective:(.+)$/u.exec(String(item))?.[1]).find(Boolean) ?? 'modeler';
  const sameHolder = (eventId) => perspectiveOf(eventId) === (lens.perspective ?? 'modeler');
  for (const person of persons) {
    const read = readPerson(index, person.id);
    const arcIds = new Set((index.arcsOf.get(person.id) ?? []).flatMap((id) => [id, ...eventDescendants(index, id)]));
    // An arc and its phases are scaffolding; what happens inside them (typing the words in, a night on the ward) is not.
    const scaffold = new Set((index.arcsOf.get(person.id) ?? []).flatMap((id) => [id, ...['anticipation', 'focal_change', 'adaptation', 'shock'].map((phase) => `${id}.${phase}`)]));
    if (lens.appliesTo.includes('act')) {
      const decisions = new Set(read.cuts.filter((item) => cutKind(item.cut) === 'decision' && decides(item.event, person.id)).map((item) => item.event.id));
      const realized = new Map();
      for (const relation of index.relations) if (relation.kind === 'realizes_forecast') for (const [from, to] of [[relation.target_event_id, relation.source_event_id], [relation.source_event_id, relation.target_event_id]]) {
        if (decisions.has(from) && !decisions.has(to)) { if (!realized.has(from)) realized.set(from, new Set()); realized.get(from).add(to); }
      }
      // What was done after a drawn decision is the act, and a reading of the decision answers it, while what was done is
      // itself a moment. When what follows is a stretch (months of a rebuild after one evening's choice), the stretch is its
      // own record, read as a stretch, and a reading made of the decision stays the moment's.
      const lifeSpan = spanOf(read.life) ?? 0;
      for (const decision of decisions) {
        const moment = index.events.get(decision);
        const done = [...(realized.get(decision) ?? [])].map((id) => index.events.get(id)).filter(Boolean);
        const stretch = (event) => { const length = spanOf(event); return length !== null && length > Math.max(10 * (spanOf(moment) ?? 0), 0.005 * lifeSpan); };
        for (const event of done) { if (stretch(event)) { add(event, 'act', person); subjects.get(event.id).stretchAfter = decision; } else add(event, 'act', person, [decision]); }
        if (!done.length || (done.every(stretch) && answeredEvents.has(decision))) add(moment, 'act', person);
      }
      const periods = new Set(read.periods.map((period) => period.id));
      for (const eventId of index.eventsOf.get(person.id) ?? []) {
        const event = index.events.get(eventId); const span = spanOf(event);
        if (!event || index.readings?.has(eventId) || !subjectIs(event, person.id) || realized.has(eventId) || eventId === read.life?.id || periods.has(eventId) || scaffold.has(eventId)
          || /\.is\.[a-z]+$/u.test(eventId) || (span !== null && span > 1) || structural(event)) continue;
        if (aboutEvents.has(eventId) || answeredEvents.has(eventId)) add(event, 'act', person);
        else if (!subjects.has(eventId) && !notActs.has(contextKindOf(index, eventId))) candidates.set(eventId, entry(event, 'act', person));
      }
    }
    if (lens.appliesTo.includes('period')) for (const period of read.periods) if (!arcIds.has(period.id)) add(period, 'period', person);
    if (lens.appliesTo.includes('life')) add(read.life, 'life', person);
    // Inner records: what the person thinks, feels or tells themselves, beneath their inner root.
    if (lens.appliesTo.includes('inner')) {
      const root = innerRootOf(index, [...(index.rootKinds ?? new Map())].map(([event_id, kind]) => ({ event_id, kind })), person.id);
      // A want that lasts most of a life is what an account is about, not a coarser account: it is not an inner record.
      const lifeLength = spanOf(read.life) ?? null;
      for (const eventId of root ? eventDescendants(index, root) : []) { const event = index.events.get(eventId); const length = spanOf(event);
        if (event && !index.readings?.has(eventId) && !structural(event) && !(lifeLength && length !== null && length >= 0.5 * lifeLength)) add(event, 'inner', person); }
    }
  }
  if (lens.appliesTo.includes('event')) for (const eventId of aboutEvents) if (!subjects.has(eventId)) add(index.events.get(eventId), 'event', null);
  // A reading the modeler made is a record, wherever it sits: a change arc, a scaffold, an Event of anyone's.
  const arcOwner = new Map();
  for (const [personId, arcs] of index.arcsOf ?? []) for (const arcId of arcs) for (const id of [arcId, ...eventDescendants(index, arcId)]) arcOwner.set(id, personId);
  const covered = new Set([...subjects.values()].flatMap((subject) => [subject.eventId, ...subject.also]));
  for (const eventId of answeredEvents) if (!covered.has(eventId)) {
    const event = index.events.get(eventId); if (!event || index.readings?.has(eventId)) continue;
    const personId = [event.participants?.subject].flat().find(Boolean) ?? arcOwner.get(eventId) ?? null;
    add(event, arcOwner.has(eventId) ? 'arc' : 'event', people.find((person) => person.id === personId) ?? null);
  }
  // An answer counts for this version of the lens when its unit carries this version's signature. An answer that carries
  // another version's signature was given to another question, and so was one without a signature once the lens has
  // been revised or when its keys are not this version's: those are stale, kept in the model and asked again.
  const unit = lensUnit(lens); const keys = lens.answers ? new Set([...lens.answers.map((answer) => answer.key), 'remainder']) : null;
  // An answer given before answers carried signatures counts when its answers are this version's and, once the lens has
  // been revised, when it was given or changed after the revision: an answer the model already held, unchanged, when the
  // revision was written was given to an earlier version.
  const sameAnswers = (a, b) => JSON.stringify((a.answers ?? []).map((x) => [x.key, x.weight]).sort()) === JSON.stringify((b.answers ?? []).map((x) => [x.key, x.weight]).sort());
  const staleness = (cut) => {
    // A reading of an Event rewritten since it was read is stale, whichever version of the lens it answers.
    const read = (cut.provenance ?? []).find((item) => String(item).startsWith('event-text:'))?.slice(11);
    if (read && read !== eventTextSignature(index.events.get(readOf.get(cut.parent_event_id) ?? cut.parent_event_id))) return 'its Event has been rewritten since it was read';
    const cutUnit = String(cut.unit ?? '');
    if (cutUnit === unit) return null;
    if (cutUnit.startsWith(`lens:${lens.id}@`)) {
      // Fixing the vocabulary of a lens whose answers were found case by case is a new version, but an answer given under
      // the same question, in keys the fixed vocabulary has, carries over: nothing it said has changed meaning.
      const signed = /^lens:[^@/]+@([0-9a-f]{16})/u.exec(cutUnit)?.[1];
      const earlier = (place.versions?.get(lens.id) ?? []).find((item) => item.signature === signed)?.version;
      if (earlier && !earlier.answers?.length && earlier.question === lens.question && keys && (cut.answers ?? []).every((answer) => keys.has(answer.key))) return null;
      return 'it answers another version of this lens';
    }
    if (keys && (cut.answers ?? []).some((answer) => !keys.has(answer.key))) return 'its answers are not this lens\'s answers';
    if ((lens.version ?? 1) > 1 && before?.has(cut.id) && sameAnswers(before.get(cut.id), cut)) return 'it was given before this lens was revised';
    return null;
  };
  for (const subject of subjects.values()) {
    const onRecord = [subject.eventId, ...subject.also].flatMap((eventId) => index.cutsByEvent.get(eventId) ?? []);
    const placed = [subject.eventId, ...subject.also].flatMap((eventId) => readsOf.get(eventId) ?? []).filter(sameHolder).flatMap((eventId) => index.cutsByEvent.get(eventId) ?? []);
    const cuts = [...placed, ...onRecord];
    subject.placement = placementOf(lens, subject, index, place.roots, place.holder);
    // Of the lens's answers, a current one counts; otherwise the first is reported stale. A Cut that only asks the
    // lens's question in its own words has no known holder: it is reported, and counts once the modeler has placed it
    // beneath a reading of this lens. A direction Cut never counts.
    const own = cuts.filter((cut) => String(cut.id).startsWith(`lens.${lens.id}.`) && !cut.conditioning);
    const matched = lens.matchesQuestion ? cuts.filter((cut) => !own.includes(cut) && lens.matchesQuestion.test(String(cut.question ?? '')) && !direction(cut)) : [];
    const counted = [...own, ...matched.filter((cut) => placed.includes(cut))];
    const answer = counted.find((cut) => !staleness(cut)) ?? null;
    if (!answer && counted.length) subject.stale = { cutId: counted[0].id, reason: staleness(counted[0]) };
    const shown = answer ?? counted[0] ?? null;
    const inWorld = own.filter((cut) => !placed.includes(cut));
    if (inWorld.length) { subject.inWorld = (shown && !placed.includes(shown) ? shown : inWorld[0]).id; subject.inWorldIds = inWorld.map((cut) => cut.id); }
    const unplacedMatches = matched.filter((cut) => !placed.includes(cut));
    if (unplacedMatches.length) subject.matched = unplacedMatches.map((cut) => cut.id);
    if (answer) {
      const ranked = (answer.answers ?? []).filter((item) => item.key !== 'remainder').slice().sort((a, b) => b.weight - a.weight);
      subject.answer = { cutId: answer.id, eventId: answer.parent_event_id, top: ranked[0]?.key ?? null, weight: ranked[0]?.weight ?? null, answers: answer.answers ?? [] };
      const tree = readingTree(lens, answer, index.cutsByEvent.get(answer.parent_event_id) ?? []);
      if (tree.opened.length) subject.answer.tree = tree;
    }
  }
  // Declined records, by a note or by an old not_applicable answer, are neither open nor read.
  for (const subject of subjects.values()) {
    const note = declines.get(subject.eventId);
    const legacy = [subject.eventId, ...subject.also].flatMap((eventId) => index.cutsByEvent.get(eventId) ?? [])
      .find((cut) => String(cut.id).startsWith(`lens.${lens.id}.`) && (cut.answers ?? []).some((answer) => answer.key === 'not_applicable' && answer.weight >= 0.99));
    if (note || legacy) { subject.declined = note ? { nodeId: note.nodeId, reason: note.reason } : { cutId: legacy.id, reason: 'answered not_applicable' }; subject.answer = null; delete subject.stale; }
  }
  const byTime = (a, b) => (a.t ?? Infinity) - (b.t ?? Infinity);
  const list = [...subjects.values()].sort(byTime);
  list.candidates = [...candidates.values()].sort(byTime);
  return list;
}

// Over a life: where a person's answer changes, and where it never does. A trajectory is an attributed account read
// from readings, not a fact about the person. It compares only compatible readings: one person, one kind of record
// (acts with acts, periods with periods, never a life reading in a sequence of acts), one version of a lens with a fixed
// vocabulary (a lens whose answers are found case by case has no trajectory until they are fixed, unless it declares
// answer families, as fear or love does). Readings are compared as whole distributions, remainder included: a reading
// that puts most of its weight on none of the answers is unclear and asserts nothing; a clear move between
// well-separated readings is a change; a close difference is a possible change; a large move that keeps the same largest
// answer is a shift. Before a cause is sought, the change is placed: in the estimate, the situation, or the person.
const familyOf = (lens, key) => { if (key === 'remainder' || !lens.families) return key; return Object.entries(lens.families).find(([, prefixes]) => [prefixes].flat().some((prefix) => (prefix instanceof RegExp ? prefix.test(key) : key.startsWith(prefix))))?.[0] ?? 'other'; };
const reading = (lens, subject) => {
  const w = {}; for (const answer of subject.answer?.answers ?? []) if (answer.weight > 0) { const k = familyOf(lens, answer.key); w[k] = (w[k] ?? 0) + answer.weight; }
  const named = Object.entries(w).filter(([key]) => key !== 'remainder');
  const mass = named.reduce((sum, [, weight]) => sum + weight, 0);
  const ranked = named.sort((a, b) => b[1] - a[1]);
  return { subject, w, mass, top: ranked[0]?.[0] ?? null, margin: ranked.length ? (ranked[0][1] - (ranked[1]?.[1] ?? 0)) / (mass || 1) : 0 };
};
const distance = (a, b) => 0.5 * [...new Set([...Object.keys(a.w), ...Object.keys(b.w)])].reduce((sum, key) => sum + Math.abs((a.w[key] ?? 0) - (b.w[key] ?? 0)), 0);
const familyKeyOf = (lens, r, key) => (lens.families ? Object.keys(r.subject.answer?.answers ? Object.fromEntries(r.subject.answer.answers.map((answer) => [answer.key, 1])) : {}).find((item) => familyOf(lens, item) === key) ?? key : key);
const show = (r) => `${r.top} ${(r.w[r.top] ?? 0).toFixed(2)} (${r.subject.label})`;
const place = 'Before you model a cause, place it: did the estimate change (read the earlier record again now), did the situation differ, or did the person change? A person may change by a shock, by a response to one, or by drift. Record the explanation you adopt as a note you hold.';
function trajectoriesOf(lens, subjects, index = null) {
  if (!lens.answers?.length && !lens.families) return [];
  const groups = new Map();
  for (const subject of subjects) if (subject.answer && subject.personId && !subject.declined) { const key = `${subject.personId}|${subject.kind}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(reading(lens, subject)); }
  const out = [];
  for (const readings of groups.values()) {
    const person = readings[0].subject.person; const kind = readings[0].subject.kind;
    const clear = readings.filter((r) => r.mass >= 0.5 && r.top); const unclear = readings.length - clear.length;
    const path = clear.map((r) => r.top);
    const base = { person, records: kind, account: 'attributed', path, readings: clear.map((r) => ({ eventId: r.subject.eventId, top: r.top, share: +(r.w[r.top] ?? 0).toFixed(3), named: +r.mass.toFixed(3) })), ...(unclear ? { unclear } : {}) };
    const of = `${person}'s ${kind === 'act' ? 'acts' : kind === 'period' ? 'periods' : `${kind} readings`}`;
    let found = false;
    // Records in time: disjoint ones form a sequence; overlapping peers are a split, two stances held at once; a record
    // nested in another is a finer record of the same stretch, neither a change nor a split. A stretch is held to what it
    // contains only by a composition the model declares, as a temporal recomposition the engine checks. Every pair is
    // checked for a split, and only disjoint neighbours for a change.
    const span = (r) => (Number.isFinite(r.subject.t) ? [r.subject.t, Number.isFinite(r.subject.end) ? r.subject.end : r.subject.t] : null);
    const timing = (a, b) => { const p = span(a); const q = span(b); if (!p || !q) return 'unknown';
      if ((p[0] <= q[0] && q[1] <= p[1]) || (q[0] <= p[0] && p[1] <= q[1])) return 'nested'; return p[0] < q[1] && q[0] < p[1] ? 'overlap' : 'disjoint'; };
    for (let i = 0; i < clear.length; i += 1) for (let j = i + 1; j < clear.length; j += 1) {
      const a = clear[i]; const b = clear[j]; const d = distance(a, b);
      const when = timing(a, b);
      if (when === 'overlap' && (a.top !== b.top || d >= 0.35)) { found = true; out.push({ ...base, kind: 'concurrent', from: a.subject.eventId, to: b.subject.eventId, distance: +d.toFixed(2),
        question: `Across ${of} under "${lens.name}", ${show(a)} and ${show(b)} overlap in time, so this is not a change but a split: two stances held at once. Toward whom or where does each hold, and does the world support both? ${lens.trajectory ?? ''}`.trim() }); }
    }
    // Macro and micro: a stretch the model composes of what happens inside it (its Events contain them) must fit them.
    // Its sub-stretches are arithmetic: read together with the rest of the stretch they make its reading, so a reading
    // left no room is a contradiction, revised, never an exception. A moment takes no share of the stretch, so a moment
    // that reads differently is a question: whom or where it concerns, room in the remainder, a turn, or a revision.
    // Inside an answer both readings opened, on a level with one vocabulary: what the fear is fear of, over time.
    const composition = (a, b) => {
      if (a.top !== b.top) return null;
      const at = (r) => r.subject.answer?.tree?.opened.find((item) => item.path.length === 1 && item.path[0] === familyKeyOf(lens, r, a.top)) ?? null;
      const x = at(a); const y = at(b); if (!x || !y || x.mass < 0.1 || y.mass < 0.1) return null;
      const same = JSON.stringify(Object.keys(x.shares).sort()) === JSON.stringify(Object.keys(y.shares).sort());
      if (!x.fixed && !same) return null;
      const tv = 0.5 * [...new Set([...Object.keys(x.shares), ...Object.keys(y.shares)])].reduce((sum, key) => sum + Math.abs((x.shares[key] ?? 0) - (y.shares[key] ?? 0)), 0);
      return tv >= 0.35 ? { tv, x, y } : null;
    };
    const kinds = (level) => Object.entries(level.shares).filter(([key]) => key !== 'remainder').sort((p, q) => q[1] - p[1]).slice(0, 2).map(([key, weight]) => `${key} ${weight.toFixed(2)}`).join(', ');
    for (let i = 1; i < clear.length; i += 1) {
      const a = clear[i - 1]; const b = clear[i]; const d = distance(a, b);
      if (timing(a, b) === 'overlap' || timing(a, b) === 'nested') continue;
      const inside = composition(a, b);
      if (inside) { found = true; out.push({ ...base, kind: 'composition', from: a.subject.eventId, to: b.subject.eventId, answer: a.top, distance: +inside.tv.toFixed(2), masses: [inside.x.mass, inside.y.mass],
        question: `Across ${of} under "${lens.name}", the reading stays ${a.top}, but what it is made of moves: ${kinds(inside.x)} (${show(a)}) to ${kinds(inside.y)} (${show(b)}), inside ${inside.x.mass.toFixed(2)} and ${inside.y.mass.toFixed(2)} of each reading. What changed in it: the estimate, the situation or the person? ${place}` }); }
      if (a.top !== b.top && d >= 0.35 && a.margin >= 0.15 && b.margin >= 0.15) { found = true; out.push({ ...base, kind: 'change', from: a.subject.eventId, to: b.subject.eventId, distance: +d.toFixed(2),
        question: `Across ${of} under "${lens.name}", the reading moves from ${show(a)} to ${show(b)}. ${place} ${lens.trajectory ?? ''}`.trim() }); }
      else if (a.top !== b.top) { found = true; out.push({ ...base, kind: 'possible-change', from: a.subject.eventId, to: b.subject.eventId, distance: +d.toFixed(2),
        question: `Across ${of} under "${lens.name}", the readings lean from ${show(a)} to ${show(b)}, but the difference is small or the readings are close calls. Is there a change at all? Look before you explain one.` }); }
      else if (d >= 0.35) { found = true; out.push({ ...base, kind: 'shift', from: a.subject.eventId, to: b.subject.eventId, distance: +d.toFixed(2),
        question: `Across ${of} under "${lens.name}", the reading stays ${a.top} but the weights move a long way (${show(a)} to ${show(b)}). What shifted: the estimate, the situation or the person?` }); }
    }
    if (!found && clear.length >= 3) out.push({ ...base, kind: 'unchanged',
      question: `Across ${clear.length} of ${of} under "${lens.name}", the reading stays ${path[0]}. Is that the person, or the choice of which records were read? If it is the person: stuck, or holding what they stand for? ${lens.trajectory ?? ''}`.trim() });
    if (unclear) out.push({ person, records: kind, kind: 'unclear', unclear, path,
      question: `${unclear} of ${of} under "${lens.name}" put most of their weight on none of its answers, so they say little under this lens. Is the lens the wrong one there, or are its answers missing one?` });
  }
  return out;
}

// Where a reading asks to be opened: an answer or remainder that carries much of it, an answer that holds while the
// reading moves a long way, and, for levels found case by case, the answers that keep recurring and should be fixed.
function openingsOf(lens, subjects, trajectories, stops, maxDepth = DEFAULT_OPEN_DEPTH) {
  const openings = []; const seen = new Set(); const recurring = new Map(); const beyond = [];
  const suggest = (subject, level, key, joint, why) => {
    const path = [...level.path, key]; const id = `${subject.eventId}|${path.join('/')}`;
    if (seen.has(id) || stops.has(`${lens.id}|${subject.eventId}|${path.join('/')}`)) return;
    if (path.length > maxDepth) { seen.add(id); beyond.push({ record: subject.eventId, path, mass: +joint.toFixed(3) }); return; }
    if ((subject.answer.tree?.opened ?? []).some((item) => item.path.join('/') === path.join('/'))) return;
    seen.add(id); const node = answerAt(lens, path);
    openings.push({ eventId: subject.answer.eventId, record: subject.eventId, person: subject.person, path, mass: +joint.toFixed(3),
      cutId: childCutId(level.cutId, key), conditionedOn: { cutId: level.cutId, answerKey: key }, question: levelQuestion(lens, path, subject), unit: levelUnit(lens, path),
      answers: node?.children?.map((child) => ({ key: child.key, meaning: child.meaning })) ?? null, why });
  };
  const levelsOf = (subject) => [{ path: [], cutId: subject.answer.cutId, mass: 1, fixed: Boolean(lens.answers), shares: Object.fromEntries(subject.answer.answers.map((answer) => [answer.key, answer.weight])) },
    ...(subject.answer.tree?.opened ?? []).map((item) => ({ path: item.path, cutId: item.cutId, mass: item.mass, fixed: item.fixed, shares: item.shares }))];
  for (const subject of subjects) {
    if (!subject.answer || subject.declined) continue;
    for (const level of levelsOf(subject)) {
      for (const [key, share] of Object.entries(level.shares)) {
        const joint = level.mass * share; if (joint < OPEN_AT) continue;
        suggest(subject, level, key, joint, key === 'remainder'
          ? `${joint.toFixed(2)} of this reading is on none of its answers. What else lies behind it? Open the remainder, or record why it stays unresolved.`
          : `"${key}" carries ${joint.toFixed(2)} of this reading. Open it if different kinds of ${key.replace(/[_-]+/gu, ' ')} would lead to different acts, read differently to others, or change what the prose must show; otherwise record why not.`);
      }
      if (level.path.length && !level.fixed) for (const key of Object.keys(level.shares)) if (key !== 'remainder') { const at = `${level.path.join('/')}|${key}`; recurring.set(at, (recurring.get(at) ?? 0) + 1); }
    }
  }
  // A reading that stays under one answer while its weights move a long way: did what it is made of change?
  const byId = new Map(subjects.map((subject) => [subject.eventId, subject]));
  for (const item of trajectories.filter((entry) => entry.kind === 'shift')) for (const eventId of [item.from, item.to]) {
    const subject = byId.get(eventId); if (!subject?.answer) continue;
    const top = subject.answer.answers.filter((answer) => answer.key !== 'remainder').sort((a, b) => b.weight - a.weight)[0]; if (!top) continue;
    suggest(subject, levelsOf(subject)[0], top.key, top.weight, `The reading stays ${top.key} across ${item.from} and ${item.to} while its weights move a long way. Did the composition of the ${top.key.replace(/[_-]+/gu, ' ')} change? Open it in both readings with the same kinds.`);
  }
  const fixLevels = [...recurring].filter(([, count]) => count >= 3).map(([at, count]) => { const [path, key] = at.split('|'); return { path: path.split('/'), key, readings: count,
    question: `Within "${path}", the answer ${key} was found case by case in ${count} readings. Fix this level: define the lens again with the kinds found as the children of ${path.split('/').at(-1)}, each with a one-line meaning (and the model's Concept where it has one), so readings can be compared inside it.` }; });
  openings.sort((a, b) => b.mass - a.mass);
  return { openings, fixLevels, beyond };
}

// The open-ended questions that keep the modeler looking for ways of seeing.
export function lensSurvey(defined = []) {
  const named = defined.filter((lens) => !lens.builtIn).map((lens) => lens.name);
  const beyond = named.length ? ` Beyond ${named.join(', ')}:` : '';
  if (!storyProfile()) return [
    `Which ways of seeing could explain what is being modeled?${beyond} There are far more than any list, in every discipline and tradition, and many have no name yet: what drives a process and what balances it, what it depends on and what depends on it, what it trades, stores or wears out, where it has a threshold, what an observer of it can and cannot see. Define the ones that would change the model, as many as you can find.`,
    'Where do two lenses read the same record differently? A disagreement between lenses is a finding: model which reading the world supports, or whether both hold at once.',
    'Which lens has not been asked yet of the parts, the whole, or what surrounds them? A lens can be asked of any Event.',
  ];
  return [
    `Which ways of seeing could explain what these people do and what happens to them? There are far more than any list: the reasons behind acts (fear or love, want or duty, shame or pride, curiosity or appetite), how people grow (from wanting, to bartering for approval, to standing for something), how they bond, what they believe they are owed, what the body and the purse allow, what an era or a class or a family expects, what a trade or an institution is really for. Look for them in thinkers and traditions, in disciplines from psychology to economics to theology, in the story's own world, and invent the ones no one has named. List as many as you can find${named.length ? ` beyond ${named.join(', ')}` : ''}, and define with life_lens_define the ones that would change what the model predicts.`,
    'Where do two lenses read the same act differently? A disagreement between lenses is a finding: model which reading the world supports, or whether both hold at once.',
    'Which lens has not been asked of the world rather than the people: the institutions, the market, the technology, the era? A lens can be asked of any Event.',
  ];
}

export const lensQuestionsSchema = z.object({
  graphHash: hash, accessScopes: z.array(id).max(64).default([]),
  holder: id.optional().describe('Whose understanding root a modeler lens\'s readings go under; by default the lens\'s own holder.'),
  modelHash: hash.optional().describe('Read this model instead of the one the graph is bound to, such as a revision not yet rebound; the lenses are still read from the graph.'),
  lensIds: z.array(z.string().max(48)).max(32).default([]).describe('Only these lenses; all when empty.'),
  limit: z.number().int().min(1).max(200).default(24).describe('How many open records to list per lens.'),
  maxDepth: z.number().int().min(1).max(64).default(DEFAULT_OPEN_DEPTH).describe('How deep openings are suggested: a limit of this inquiry, raised here, not a ceiling of the language.'),
}).strict();

export async function lensQuestions(service, raw) {
  const input = lensQuestionsSchema.parse(raw);
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.accessScopes)].sort() });
  const modelHash = input.modelHash ?? view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
  if (!modelHash) throw new Error('The graph is not bound to a model, so there are no records to ask a lens of.');
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const index = indexModel(model); const people = modeledPeople(index);
  const lenses = readLenses(view).filter((lens) => !input.lensIds.length || input.lensIds.includes(lens.id));
  // For a revised lens, the answers the model held when the revision was written, to tell earlier answers from later ones.
  const heldAt = new Map();
  for (const hash of new Set(lenses.filter((lens) => (lens.version ?? 1) > 1 && lens.writtenAgainst).map((lens) => lens.writtenAgainst))) {
    const held = await service.inspectModel({ modelHash: hash, includeDefinition: true }).catch(() => null);
    heldAt.set(hash, new Map((held?.model?.meaning_model?.normalized_cuts ?? []).map((cut) => [cut.id, cut])));
  }
  const declines = readDeclines(view);
  const fallbackHolder = input.holder ?? lenses.find((lens) => lens.holder)?.holder ?? 'modeler';
  const holderFor = (lens) => input.holder ?? lens.holder ?? fallbackHolder;
  const drawn = new Set(readDraws(view).map((draw) => draw.cutId));
  const stops = readSufficiency(view); const versions = lensVersions(view);
  const results = lenses.map((lens) => {
    const subjects = subjectsOf(lens, index, people, heldAt.get(lens.writtenAgainst) ?? null, declines.get(lens.id) ?? new Map(), { roots: model.meaning_model?.context_roots ?? [], holder: holderFor(lens), drawn, versions });
    const open = subjects.filter((subject) => !subject.answer && !subject.declined);
    const trajectories = trajectoriesOf(lens, subjects, index);
    const { openings, fixLevels, beyond } = openingsOf(lens, subjects, trajectories, stops, input.maxDepth);
    return {
      id: lens.id, name: lens.name, builtIn: Boolean(lens.builtIn), version: lens.version ?? 1, unit: lensUnit(lens), question: lens.question, appliesTo: lens.appliesTo,
      perspective: lens.perspective ?? 'modeler', reading: lens.reading ?? 'support', status: lens.status ?? 'authored', ...(lens.unitMeaning ? { unitMeaning: lens.unitMeaning } : {}), ...(lens.families ? { families: lens.families } : {}),
      inWorld: subjects.filter((subject) => subject.inWorld).length,
      answers: lens.answers ?? null, records: subjects.length, answered: subjects.filter((subject) => subject.answer).length, declined: subjects.filter((subject) => subject.declined).length, stale: subjects.filter((subject) => subject.stale).length,
      ...(!lens.answers?.length && !lens.families ? { exploratory: 'This lens finds its answers case by case, so its readings are not comparable and it has no trajectories. When the answers found have settled, define it again with a fixed vocabulary.' } : {}),
      open: open.slice(0, input.limit).map((subject) => ({ eventId: subject.eventId, kind: subject.kind, person: subject.person, t: subject.t,
        question: questionFor(lens, subject),
        ...(subject.also.length ? { decidedAt: subject.also } : {}), ...(subject.stretchAfter ? { stretch: `What was done after ${subject.stretchAfter} runs from ${subject.t} to ${subject.end}: this record is the whole stretch, read as a stretch. A reading of the moment of choosing belongs on that moment.` } : {}), cutId: subject.stale?.cutId ?? `lens.${lens.id}.${subject.eventId}`, unit: lensUnit(lens),
        ...(subject.stale ? { stale: subject.stale.reason, replaceExisting: true } : {}), placement: subject.placement,
        ...(subject.sharedWith.length ? { sharedWith: subject.sharedWith, shared: `${subject.sharedWith.join(' and ')} take${subject.sharedWith.length === 1 ? 's' : ''} part. An act of theirs here is asked of them when it is modeled as its own Event with them as its subject: the lens then lists it as a candidate.` } : {}),
        ...(subject.matched ? { matched: subject.matched, resolve: 'These Cuts ask this lens\'s question in their own words, so whose reading they are is unknown and they do not count. Say with life_lens_place resolve: canon (the actor\'s own reasons, moved to their inner Event at the decision), reading (the modeler\'s, moved beneath the modeler\'s root), or direction (a decision\'s continuations, left as they are).' } : {}),
        ...(!subject.person && lens.appliesTo.some((kind) => kind !== 'event') ? { noSubject: 'This record names no person, so a lens about people is asked of no one in particular. If it is someone\'s act, name them as the Event\'s subject (participants.subject); otherwise say in situationText whose act or experience is read.' } : {}),
        ...(subject.note ? { warning: `This Event's description reads like a note to the modeler ("${subject.note}"); the estimator would judge it as what happens. Keep descriptions to the world.` } : {}) })),
      trajectories,
      openings: openings.slice(0, input.limit), openingCount: openings.length, ...(fixLevels.length ? { fixLevels } : {}),
      ...(beyond.length ? { beyondDepthLimit: { limit: input.maxDepth, count: beyond.length, openings: beyond.slice(0, input.limit), raise: 'Pass maxDepth to suggest openings deeper than this.' } } : {}),
      candidates: subjects.candidates.slice(0, input.limit).map((subject) => ({ eventId: subject.eventId, person: subject.person, t: subject.t, label: subject.label, cutId: `lens.${lens.id}.${subject.eventId}`, placement: placementOf(lens, subject, index, model.meaning_model?.context_roots ?? [], holderFor(lens)), ...(subject.sharedWith.length ? { sharedWith: subject.sharedWith } : {}) })),
      candidateCount: subjects.candidates.length,
    };
  });
  return {
    schema: 'meaning-model-lens-questions/v1', graphHash: input.graphHash, modelHash, lenses: results, survey: lensSurvey(lenses),
    howToOpen: `A reading opens into kinds, level by level: fear, then fear of what. Each opening is a Cut on the same reading Event, conditioned on the answer it divides, with its own remainder: estimate it with the cutId, question, unit and conditionedOn given, and the estimator is told which answer it divides but not its weight. Shares multiply down a path, so the tree's joint shares measure answers at any depth against each other. Open where the finer kinds would change a later act, a decision, how others read it or what the prose must show, or where the remainder is heavy; stop where they would change nothing, and record the stop as an Understanding Node about the record's Event with data { schema: ${LENS_SUFFICIENCY_SCHEMA}, lensId, path, reason, reopenIf }. A level found case by case becomes comparable once it is fixed: define the lens again with those answers as children.`,
    howToAnswer: 'A reading is held by someone, so it goes beneath them: run life_lens_place first, which adds the holder\'s root and one reading Event per record (placement.eventId), linked about the record, and moves readings that still sit on the record. Then estimate with the reading Event as the target: its situation is the record\'s text (for a character reader, pass what they could know), and the Cut goes on the reading Event. Answer each open record as a Cut with life_model_revise or the estimator: the cutId given, the question asked of that record, and answers weighted to sum to 1, with a remainder for what the lens does not name. Use the lens\'s answers where it has them and find your own where it has none. Estimate the weights with the estimator where one is configured, many records in one call (every applied estimate registers a model revision), then rebind the story graph. Give each answer the unit shown, which binds it to this version of the lens: answers given to an earlier version are listed again as stale, to be answered again with replaceExisting under the same Cut id. Answers are yours to find: a lens asks, it does not decide. A record the lens does not fit is declined, not answered: record an Understanding Node about its Event with data { schema: meaning-model-lens-decline/v1, lensId, reason }, and it stops being asked. Candidates are the other moments a person is the subject of, where the lens might also fit: the model does not say which are acts, so choose, and answering a candidate with its Cut id makes it one of the lens\'s records. An act that follows a drawn decision is asked of what was done (decidedAt names the decision). An answered reading can be opened deeper, into the kinds of an answer: see howToOpen and each lens\'s openings.',
    graphMutation: false, worldMutation: false,
  };
}

// For the model's open questions: the lenses with records still to answer, one question each.
export function lensOpenQuestions(view, model) {
  const index = indexModel(model); const people = modeledPeople(index); const declines = readDeclines(view);
  const roots = model?.meaning_model?.context_roots ?? []; let unplaced = 0; const unplacedLenses = []; const drawn = new Set(readDraws(view).map((draw) => draw.cutId));
  const questions = readLenses(view).flatMap((lens) => {
    const subjects = subjectsOf(lens, index, people, null, declines.get(lens.id) ?? new Map(), { roots, holder: lens.holder ?? 'modeler', drawn });
    // Only the lens's own Cuts: one that merely matches its question may be canon, and placing leaves it where it is.
    const inWorld = subjects.filter((subject) => (subject.inWorldIds ?? []).some((cutId) => cutId.startsWith(`lens.${lens.id}.`))).length; if (inWorld) { unplaced += inWorld; unplacedLenses.push(lens.id); }
    const open = subjects.filter((subject) => !subject.answer && !subject.declined);
    if (!open.length) return [];
    return [{ kind: 'lens-open', subject: lens.id, principal: true, tool: 'life_lens_questions',
      question: `The lens "${lens.name}" has ${open.length} of ${subjects.length} records without an answer, from ${phrase(open[0])}. Ask it of them with life_lens_questions, and look for the lenses that would see what it cannot.` }];
  });
  if (unplaced) questions.unshift({ kind: 'lens-unplaced', subject: unplacedLenses.join(', '), principal: true, tool: 'life_lens_place',
    question: `${unplaced} lens reading${unplaced === 1 ? ' sits' : 's sit'} on the record${unplaced === 1 ? '' : 's'} ${unplaced === 1 ? 'it reads' : 'they read'} (${unplacedLenses.slice(0, 6).join(', ')}), so an interpretation carries the world's authority. Place them beneath their holder with life_lens_place.` });
  return questions;
}

// ---- placing readings -----------------------------------------------------------------------------------------
export const lensPlaceSchema = z.object({
  graphHash: hash, requestId: id, accessScopes: scopeList,
  modelHash: hash.optional().describe('The model to revise; by default the one the graph is bound to.'),
  lensIds: z.array(z.string().max(48)).max(32).default([]).describe('Only these lenses; all when empty.'),
  holder: id.optional().describe('Whose understanding root modeler readings go under; by default each lens\'s holder.'),
  records: z.enum(['all', 'open', 'in-world']).default('all').describe('Which records get a reading Event: every record of a lens, the open ones, or those whose reading still sits on the record.'),
  eventIds: z.array(id).max(500).default([]).describe('Candidates to place as well, such as the moments you are about to answer: an answer on their reading Event makes them records.'),
  migrate: z.boolean().default(true).describe('Move the lens\'s Cuts that sit on the record itself onto its reading Event: same Cut ids, questions, units and weights, so the claim is unchanged and only its holder becomes structural. Each goes by the perspective of the lens version it answered.'),
  resolve: z.array(z.object({ cutId: id, as: z.enum(['canon', 'reading', 'direction']) }).strict()).max(200).default([])
    .describe('Say whose each matched Cut is (a Cut that asks a lens\'s question in its own words): canon, the actor\'s own reasons, moved to their inner Event at the decision; reading, the modeler\'s, moved beneath the modeler\'s root; direction, a decision\'s continuations, left where it is and no longer reported.'),
  worldRoot: z.object({
    id: id.default('history').describe('The id of the History Event to create.'),
    otherRoots: z.array(z.object({ eventId: id, kind: z.enum(['accepted_world', 'document', 'candidate', 'inner', 'understanding']) }).strict()).max(64).default([])
      .describe('Top Events that are not this world (another world, a concept model, an author\'s life, a counterfactual scene), each given its own root of this kind.'),
  }).strict().optional().describe('For a model that declares no context roots: contain the world\'s top Events under one untimed History Event, declared accepted world. Without it such a model is not changed: the tool lists its top Events.'),
  dryRun: z.boolean().default(false).describe('Report what placement would do, without revising the model.'),
  reason: z.string().trim().min(8).max(2_000).default('Place each lens reading beneath its holder, linked about the record it reads, so an interpretation does not carry the world\'s authority.'),
  rebind: z.object({ graphHash: hash, requestId: id.optional(), accessScopes: scopeList }).strict().optional().describe('Rebind this graph to the revised model in the same call.'),
}).strict();

// Every version of each lens, with the signature its answers carry, so an answer to an earlier version can be recognised.
function lensVersions(view) {
  // A built-in lens is the first version of any lens defined with its id.
  const versions = new Map(BUILT_IN_LENSES.map((lens) => [lens.id, [{ version: lens, signature: lensSignature(lens) }]]));
  for (const node of readLensNodes(view)) { const version = { ...node.data }; if (!versions.has(version.id)) versions.set(version.id, []); versions.get(version.id).push({ version, signature: lensSignature(version) }); }
  return versions;
}

export async function placeReadings(service, raw) {
  const input = lensPlaceSchema.parse(raw);
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.accessScopes)].sort() });
  const modelHash = input.modelHash ?? view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
  if (!modelHash) throw new Error('The graph is not bound to a model, so there are no readings to place.');
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const index = indexModel(model); const people = modeledPeople(index);
  const successor = structuredClone(model); const mm = successor.meaning_model ??= {};
  for (const key of ['events', 'event_relations', 'context_roots', 'normalized_cuts']) mm[key] ??= [];
  const hadRoots = mm.context_roots.length > 0;
  const events = new Map(mm.events.map((event) => [event.id, event])); const relationIds = new Set(mm.event_relations.map((relation) => relation.id));
  const cuts = new Map(mm.normalized_cuts.map((cut) => [cut.id, cut]));
  const provenance = [READING_MARK];
  const added = { roots: [], events: [], relations: [], worldRoot: null, worldContains: [], otherRoots: [] }; const moved = []; const kept = []; const refused = []; const resolved = [];
  const relate = (relationId, source, target, kind, description) => {
    if (relationIds.has(relationId)) return; relationIds.add(relationId);
    mm.event_relations.push({ id: relationId, source_event_id: source, target_event_id: target, kind, description, uncertainty: { kind: 'unknown' }, provenance }); added.relations.push(relationId);
  };
  // A Cut that conditions on another, is conditioned on, or takes part in a recomposition keeps one context with its chain.
  const chains = [...mm.normalized_cuts.filter((cut) => cut.conditioning?.cut_id).map((cut) => [cut.id, cut.conditioning.cut_id]),
    ...(mm.temporal_cut_recompositions ?? []).flatMap((item) => (item.children ?? []).map((child) => [item.parent_cut_id, child.cut_id]))];
  const chained = new Set(chains.flat());
  const lenses = readLenses(view).filter((lens) => !input.lensIds.length || input.lensIds.includes(lens.id));
  const declines = readDeclines(view); const drawn = new Set(readDraws(view).map((draw) => draw.cutId));
  const fallbackHolder = input.holder ?? lenses.find((lens) => lens.holder)?.holder ?? 'modeler';
  const asked = new Set(input.eventIds); const found = new Set(); const resolutions = new Map(input.resolve.map((item) => [item.cutId, item.as]));
  // The root and the reading Event a placement needs, made when missing. False when there is nowhere to put it.
  const ensure = (place, lens, subject, holder) => {
    if (!place.root) { refused.push({ lens: lens.id, eventId: subject.eventId, reason: `${subject.person ?? 'this person'} has no inner root to hold ${place.perspective === 'actor' ? 'their own reasons' : 'their reading'}: declare one (a context root of kind inner beneath their life) first` }); return false; }
    if (place.rootKind === 'understanding' && !mm.context_roots.some((root) => root.event_id === place.root)) {
      if (events.has(place.root)) { refused.push({ lens: lens.id, eventId: subject.eventId, reason: `an Event ${place.root} already exists and is not a declared root, so it cannot hold readings` }); return false; }
      const root = { id: place.root, boundary: `What ${holder} understands of this model`, description: `The readings ${holder} holds of the world, kept beneath them and apart from it: each reads a record it is about, and none is a fact of the world.`, process_ids: [], provenance };
      mm.events.push(root); events.set(root.id, root);
      mm.context_roots.push({ event_id: place.root, kind: 'understanding', provenance }); added.roots.push(place.root);
    }
    if (!events.has(place.eventId)) {
      const whose = place.perspective === 'actor' ? `${subject.person ?? 'the actor'}'s own reasons, as canon` : `${holder}'s reading`;
      const decision = place.decidedAt ? (index.cutsByEvent.get(place.decidedAt) ?? []).filter((cut) => cutKind(cut) === 'decision') : [];
      const afterDraw = decision.some((cut) => drawn.has(cut.id));
      const reading = { id: place.eventId, boundary: `${whose} under "${lens.name}": ${phrase(subject)}`.slice(0, 900),
        description: `${whose}, under the lens "${lens.name}", of ${phrase(subject)}. It is about that record and does not take part in it.`.slice(0, 2_000),
        process_ids: [], ...(place.interval ? { interval: place.interval } : {}), ...(place.rootKind === 'inner' && place.person ? { participants: { subject: place.person } } : {}),
        provenance: [...provenance, `lens:${lens.id}`, `perspective:${place.perspective}`, `holder:${holder}`, ...(place.decidedAt ? [`decided-at:${place.decidedAt}`] : []),
          ...(afterDraw ? ['after-draw: these reasons were set after the decision was drawn, a retrospective account'] : [])] };
      mm.events.push(reading); events.set(reading.id, reading); added.events.push(reading.id);
    }
    relate(`contains.${place.root}.${place.eventId}`, place.root, place.eventId, 'contains', 'Holds this reading.');
    relate(`about.${place.eventId}`, place.eventId, place.about, 'about', `Reads this record under the lens "${lens.name}".`);
    return true;
  };
  for (const lens of lenses) {
    const holder = input.holder ?? lens.holder ?? fallbackHolder;
    const subjects = subjectsOf(lens, index, people, null, declines.get(lens.id) ?? new Map(), { roots: model.meaning_model?.context_roots ?? [], holder, drawn });
    const wanted = subjects.filter((subject) => !(subject.declined && !subject.inWorld)
      && (asked.has(subject.eventId) || input.records === 'all' || subject.matched || (input.records === 'open' ? !subject.answer && !subject.declined : Boolean(subject.inWorld))));
    for (const subject of [...wanted, ...subjects.candidates.filter((candidate) => asked.has(candidate.eventId))]) {
      found.add(subject.eventId);
      const place = placementOf(lens, subject, index, mm.context_roots, holder);
      if (!ensure(place, lens, subject, holder)) continue;
      if (input.migrate) for (const cutId of subject.inWorldIds ?? []) {
        const cut = cuts.get(cutId); if (!cut) continue;
        // A reading's deeper levels move with it: the lens's Cuts on the same Event conditioned, level by level, on this one.
        const members = new Set([cut.id]);
        for (let grew = true; grew;) { grew = false; for (const other of mm.normalized_cuts) if (!members.has(other.id) && other.conditioning?.cut_id && members.has(other.conditioning.cut_id)
          && other.parent_event_id === cut.parent_event_id && String(other.id).startsWith(`lens.${lens.id}.`)) { members.add(other.id); grew = true; } }
        if (chains.some(([a, b]) => (members.has(a) || members.has(b)) && !(members.has(a) && members.has(b)))) { refused.push({ lens: lens.id, eventId: subject.eventId, cutId, reason: 'it conditions, is conditioned on, or recomposes with a Cut outside its reading: move the chain together' }); continue; }
        // A lens keeps its perspective across its versions, so every one of its readings goes beneath the same holder.
        for (const memberId of members) { const member = cuts.get(memberId); if (member.parent_event_id !== place.eventId) { member.parent_event_id = place.eventId; moved.push(memberId); } }
      }
      for (const cutId of subject.matched ?? []) {
        const as = resolutions.get(cutId); const cut = cuts.get(cutId);
        if (!cut) continue;
        if (!as) { kept.push({ lens: lens.id, eventId: subject.eventId, cutId, reason: 'it asks the lens\'s question in its own words, so whose it is is unknown: resolve it as canon, reading or direction' }); continue; }
        if (as === 'direction') { if (!(cut.provenance ?? []).includes('lens-resolved:direction')) cut.provenance = [...(cut.provenance ?? []), 'lens-resolved:direction']; resolved.push({ cutId, as }); continue; }
        if (chained.has(cutId)) { refused.push({ lens: lens.id, eventId: subject.eventId, cutId, reason: 'it conditions, is conditioned on, or recomposes with another Cut: move the chain together' }); continue; }
        const other = { ...lens, perspective: as === 'canon' ? 'actor' : 'modeler' };
        const target = placementOf(other, subject, index, mm.context_roots, holder);
        if (!ensure(target, other, subject, holder)) continue;
        cut.parent_event_id = target.eventId; resolved.push({ cutId, as, eventId: target.eventId });
      }
    }
  }
  for (const cutId of resolutions.keys()) if (!resolved.some((item) => item.cutId === cutId) && !refused.some((item) => item.cutId === cutId)) refused.push({ cutId, reason: 'not a matched Cut of these lenses' });
  const unknown = [...asked].filter((eventId) => !found.has(eventId));
  // A model that declared no roots held everything as one world. Once a root is declared every Event needs one, and a
  // world has one root: an untimed History Event that contains the world's top Events. Others get their own roots.
  const topEvents = () => { const contained = new Set(mm.event_relations.filter((relation) => relation.kind === 'contains').map((relation) => relation.target_event_id));
    const declared = new Set(mm.context_roots.map((root) => root.event_id)); return mm.events.filter((event) => !contained.has(event.id) && !declared.has(event.id)).map((event) => event.id); };
  if (!hadRoots && added.roots.length) {
    const top = topEvents();
    if (!input.worldRoot) return { schema: 'meaning-model-lens-placement/v1', plan: true, previousModelHash: modelHash, modelHash, graphMutation: false, topEventCount: top.length, topEvents: top.slice(0, 200),
      nextStep: 'This model declares no context roots, and a reading needs its holder\'s root. Once one root is declared every Event needs one, and a world has one: call again with worldRoot to contain these top Events under one untimed History Event, declared accepted world, and give any that are not this world (another world, a concept model, an author\'s life, a counterfactual scene) their own root in worldRoot.otherRoots.' };
    const others = new Map(input.worldRoot.otherRoots.map((item) => [item.eventId, item.kind]));
    const strays = [...others.keys()].filter((eventId) => !top.includes(eventId));
    if (strays.length) throw new Error(`worldRoot.otherRoots names Events that are not top Events of this model: ${strays.join(', ')}.`);
    const historyId = input.worldRoot.id;
    if (events.has(historyId)) throw new Error(`An Event ${historyId} already exists; name the History Event with worldRoot.id.`);
    const history = { id: historyId, boundary: 'History: the world of this model', description: 'The world the model holds, as one context. Every Event of this world is contained here; readings, other worlds and models sit under roots of their own.', process_ids: [], provenance };
    mm.events.push(history); events.set(historyId, history);
    mm.context_roots.push({ event_id: historyId, kind: 'accepted_world', provenance }); added.worldRoot = historyId;
    for (const eventId of top) {
      if (others.has(eventId)) { mm.context_roots.push({ event_id: eventId, kind: others.get(eventId), provenance }); added.otherRoots.push(eventId); }
      else { relate(`contains.${historyId}.${eventId}`, historyId, eventId, 'contains', 'Part of this world.'); added.worldContains.push(eventId); }
    }
    if (added.otherRoots.length) {
      const parentOf = new Map(mm.event_relations.filter((relation) => relation.kind === 'contains').map((relation) => [relation.target_event_id, relation.source_event_id]));
      const rootOf = (eventId) => { let at = eventId; for (let step = 0; step < 256 && parentOf.has(at) && !others.has(at); step += 1) at = parentOf.get(at); return at; };
      const parentEvent = new Map(mm.normalized_cuts.map((cut) => [cut.id, cut.parent_event_id]));
      const crossing = chains.filter(([a, b]) => parentEvent.has(a) && parentEvent.has(b) && rootOf(parentEvent.get(a)) !== rootOf(parentEvent.get(b)));
      if (crossing.length) throw new Error(`Giving ${added.otherRoots.join(', ')} roots of their own would split Cuts that condition or recompose across them (${crossing.slice(0, 4).map((pair) => pair.join(' / ')).join('; ')}). Keep those Events in this world, or move the chain first.`);
    }
  }
  // Estimates made without an Event-text signature may predate keeping lens readings out of a person's modeled state.
  const dependents = mm.normalized_cuts.filter((cut) => !String(cut.id).startsWith('lens.') && !index.readings?.has(cut.parent_event_id)
    && (cut.provenance ?? []).some((item) => String(item).startsWith('estimator:')) && !(cut.provenance ?? []).some((item) => String(item).startsWith('event-text:'))).map((cut) => cut.id);
  const common = { schema: 'meaning-model-lens-placement/v1', previousModelHash: modelHash, rootsAdded: added.roots, ...(added.worldRoot ? { worldRoot: added.worldRoot, worldContains: added.worldContains, otherRoots: added.otherRoots } : {}),
    readingEventsAdded: added.events.length, relationsAdded: added.relations.length, moved: moved.length, movedCutIds: moved.slice(0, 200), ...(moved.length > 200 ? { movedCutIdsShown: `the first 200 of ${moved.length}` } : {}), resolved, kept, refused,
    ...(unknown.length ? { notRecords: unknown.slice(0, 60) } : {}),
    recheck: { count: dependents.length, cutIds: dependents.slice(0, 60), ...(dependents.length > 60 ? { cutIdsShown: `the first 60 of ${dependents.length}` } : {}),
      why: 'These were estimated without an Event-text signature, so they may predate keeping lens readings out of a person\'s modeled state, and may have read readings as state. Re-estimate the ones that matter.',
      how: 'Recheck each with the situation text it was made from, its question and its answers. The model keeps only a signature of a situation (situation: in provenance, for estimates made from now on), so for older ones use the inputs they were made from. A decision Event alone often gives the estimator almost nothing, since its description defers to its Cut.' } };
  const changed = added.events.length || moved.length || added.roots.length || added.relations.length || resolved.length;
  if (!changed) return { ...common, modelHash, graphMutation: false, nextStep: kept.length ? 'Every lens Cut already sits beneath its holder. Resolve the kept Cuts: canon, reading or direction.' : 'Every reading of these lenses already sits beneath its holder.' };
  if (input.dryRun) return { ...common, modelHash, dryRun: true, graphMutation: false, nextStep: 'Nothing was changed. Call again without dryRun to place these readings.' };
  successor.revision = { number: Number(model.revision?.number ?? 0) + 1, previous_model_hash: modelHash, provenance: [...provenance, ...(model.revision?.provenance ?? []).slice(0, 8)], reason: input.reason };
  const revised = await service.reviseModel({ requestId: input.requestId, previousModelHash: modelHash, model: successor });
  const next = 'New readings: estimate with each reading Event (placement.eventId in life_lens_questions) as the target. The estimator reads the record it is about, with the evidence the holder may use, and the Cut goes on the reading Event.';
  let rebound = null;
  if (input.rebind) {
    try { rebound = await rebindNarrativeGraph(service, { requestId: input.rebind.requestId ?? `${input.requestId}-rebind`, graphHash: input.rebind.graphHash, modelHash: revised.modelHash, accessScopes: input.rebind.accessScopes, reason: input.reason }); }
    catch (error) { return { ...common, modelHash: revised.modelHash, revisionNumber: successor.revision.number, rebound: null, graphMutation: false, partial: true, failure: { stage: 'rebind', message: error.message }, nextStep: `The model revision succeeded but the rebind failed: rebind the graph to ${revised.modelHash} with life_narrative_rebind. ${next}` }; }
  }
  return { ...common, modelHash: revised.modelHash, revisionNumber: successor.revision.number, rebound, graphMutation: Boolean(rebound), nextStep: `${rebound ? 'The graph is rebound.' : 'Rebind the story graph to the revised model.'} ${next}${kept.length ? ' Resolve the kept Cuts: canon, reading or direction.' : ''}` };
}

// ---- reading again ------------------------------------------------------------------------------------------------
// A reading depends on the text and the state it read, so a rewrite makes it stale. Reading again asks the same question
// with the same answers and unit of the record as it now is, every stale reading of the records named at once, across
// lenses, and applies them in one revision, reporting how far each moved.
export const lensRereadSchema = z.object({
  graphHash: hash, requestId: id, accessScopes: scopeList,
  modelHash: hash.optional().describe('Read this model instead of the one the graph is bound to.'),
  eventIds: z.array(id).max(64).default([]).describe('The records whose stale readings to read again, by their Event id; every stale reading when empty.'),
  lensIds: z.array(z.string().max(48)).max(32).default([]).describe('Only these lenses; all when empty.'),
  situationText: z.record(id, z.string().trim().min(1).max(16_000)).default({}).describe('For a reading whose holder may not read the record itself (a character, or a lens that reads the prose): their observation or the passage, by record id.'),
  samples: z.number().int().min(1).max(5).default(1).describe('How many times to read each: with more than one, the mean is applied and the spread between readings is reported, so a move within the estimator\'s own noise shows as noise.'),
  rebind: z.object({ graphHash: hash, requestId: id.optional(), accessScopes: scopeList }).strict().optional().describe('Rebind this graph to the revised model in the same call.'),
}).strict();

const tv = (a, b) => { const x = Object.fromEntries((a.answers ?? []).map((answer) => [answer.key, answer.weight])); const y = Object.fromEntries((b.answers ?? []).map((answer) => [answer.key, answer.weight]));
  return 0.5 * [...new Set([...Object.keys(x), ...Object.keys(y)])].reduce((sum, key) => sum + Math.abs((x[key] ?? 0) - (y[key] ?? 0)), 0); };

export async function rereadLenses(service, estimator, raw) {
  const input = lensRereadSchema.parse(raw);
  if (!estimator) throw new Error('Reading again needs the configured estimator (MEANING_MODEL_ESTIMATOR). Without one, answer each stale reading listed by life_lens_questions with life_estimate_cut_shares.');
  const asked = await lensQuestions(service, { graphHash: input.graphHash, accessScopes: input.accessScopes, ...(input.modelHash ? { modelHash: input.modelHash } : {}), lensIds: input.lensIds, limit: 200 });
  const { model } = await service.inspectModel({ modelHash: asked.modelHash, includeDefinition: true });
  const cuts = new Map((model.meaning_model?.normalized_cuts ?? []).map((cut) => [cut.id, cut]));
  const again = new Set(['its Event has been rewritten since it was read']);
  const version = new Set(['it answers another version of this lens', 'its answers are not this lens\'s answers', 'it was given before this lens was revised']);
  const confidenceOf = (cut) => { const item = (cut?.provenance ?? []).find((entry) => /^confidence \d/u.test(String(entry))); return item ? Number(String(item).slice(11, 16)) : null; };
  const stale = asked.lenses.flatMap((lens) => lens.open.filter((item) => item.stale && (!input.eventIds.length || input.eventIds.includes(item.eventId))).map((item) => ({ lens, item })));
  const read = []; const skipped = []; let calls = 0;
  for (const { lens, item } of stale) {
    const old = cuts.get(item.cutId);
    if (!old) { skipped.push({ lens: lens.id, record: item.eventId, cutId: item.cutId, reason: 'not in the model' }); continue; }
    const byVersion = version.has(item.stale);
    if (!again.has(item.stale) && !byVersion) { skipped.push({ lens: lens.id, record: item.eventId, cutId: item.cutId, reason: `stale because ${item.stale}: answer it with life_estimate_cut_shares` }); continue; }
    // A rewrite is read again as it was asked; an answer to an earlier version is answered under this one.
    const answers = lens.answers?.length ? lens.answers.map((answer) => ({ key: answer.key, meaning: answer.meaning }))
      : (old.answers ?? []).filter((answer) => answer.key !== 'remainder').map((answer) => ({ key: answer.key, meaning: answer.key.replace(/[_-]+/gu, ' ') }));
    const question = byVersion ? item.question : old.question; const unit = byVersion ? item.unit : old.unit;
    try {
      const samples = [];
      for (let n = 0; n < input.samples; n += 1) {
        const result = await proposeCutShares({ question, unit, answers, modelHash: asked.modelHash, replaceExisting: true, apply: false,
          events: [{ eventId: old.parent_event_id, cutId: old.id, situationText: input.situationText[item.eventId] ?? null, conditionedOn: old.conditioning ? { cutId: old.conditioning.cut_id, answerKey: old.conditioning.answer_key } : null }] }, estimator, service);
        calls += result.estimatorCallsThisRequest ?? 0;
        if (result.proposals?.[0]) samples.push(result.proposals[0]);
      }
      if (!samples.length) { skipped.push({ lens: lens.id, record: item.eventId, cutId: old.id, reason: 'the estimator returned no reading' }); continue; }
      const keys = [...new Set(samples.flatMap((sample) => sample.answers.map((answer) => answer.key)))];
      const mean = keys.map((key) => ({ key, weight: samples.reduce((sum, sample) => sum + (sample.answers.find((answer) => answer.key === key)?.weight ?? 0), 0) / samples.length }));
      const total = mean.reduce((sum, answer) => sum + answer.weight, 0); for (const answer of mean) answer.weight /= total || 1;
      let spread = 0; for (const x of samples) for (const y of samples) spread = Math.max(spread, tv(x, y));
      const confidences = samples.map(confidenceOf).filter((value) => value !== null);
      const proposal = { ...samples[0], question, unit, answers: mean,
        provenance: [...samples[0].provenance.filter((entry) => !/^confidence \d/u.test(String(entry))), `confidence ${confidences.length ? (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3) : 'unknown'}; top ${[...mean].filter((answer) => answer.key !== 'remainder').sort((a, b) => b.weight - a.weight)[0]?.key ?? 'remainder'}`,
          ...(samples.length > 1 ? [`reread: mean of ${samples.length} readings, spread ${spread.toFixed(3)}`] : [])] };
      read.push({ lens: lens.id, record: item.eventId, old, proposal, spread: samples.length > 1 ? spread : null, byVersion, confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null });
    } catch (error) { skipped.push({ lens: lens.id, record: item.eventId, cutId: old.id, reason: error.message }); }
  }
  const topOf = (cut) => (cut.answers ?? []).filter((answer) => answer.key !== 'remainder').sort((a, b) => b.weight - a.weight)[0] ?? null;
  const report = read.map(({ lens, record, old, proposal, spread, byVersion, confidence }) => { const moved = tv(old, proposal);
    return { lens, record, cutId: old.id, moved: +moved.toFixed(3), before: topOf(old) ? `${topOf(old).key} ${topOf(old).weight.toFixed(2)}` : null, after: topOf(proposal) ? `${topOf(proposal).key} ${topOf(proposal).weight.toFixed(2)}` : null,
      confidenceBefore: confidenceOf(old), confidence: confidence === null ? null : +confidence.toFixed(3), ...(spread !== null ? { spread: +spread.toFixed(3) } : {}), ...(byVersion ? { answeredUnder: 'this version of the lens' } : {}),
      ...((spread !== null && moved <= spread) || (spread === null && confidence !== null && confidence < 0.6 && moved > 0.2) ? { noise: spread !== null ? 'the move is within the spread between readings: the estimator\'s noise, not a change' : 'a large move at low confidence may be the estimator\'s noise: read it again with samples above one' } : {}) }; });
  const common = { schema: 'meaning-model-lens-reread/v1', previousModelHash: asked.modelHash, stale: stale.length, read: report, skipped, estimatorCalls: calls };
  if (!read.length) return { ...common, modelHash: asked.modelHash, graphMutation: false, nextStep: stale.length ? 'Nothing could be read again: see skipped.' : 'Nothing is stale.' };
  const successor = structuredClone(model);
  for (const { old, proposal } of read) { const at = successor.meaning_model.normalized_cuts.findIndex((cut) => cut.id === old.id); successor.meaning_model.normalized_cuts[at] = { ...old, question: proposal.question ?? old.question, unit: proposal.unit ?? old.unit, answers: proposal.answers, provenance: proposal.provenance }; }
  successor.revision = { number: Number(model.revision?.number ?? 0) + 1, previous_model_hash: asked.modelHash, provenance: ['Meaning Model lens reread v1', ...(model.revision?.provenance ?? []).slice(0, 8)],
    reason: `Read ${read.length} reading${read.length === 1 ? '' : 's'} again of records rewritten since they were read, with the same questions, answers and units.` };
  const revised = await service.reviseModel({ requestId: input.requestId, previousModelHash: asked.modelHash, model: successor });
  let rebound = null;
  if (input.rebind) {
    try { rebound = await rebindNarrativeGraph(service, { requestId: input.rebind.requestId ?? `${input.requestId}-rebind`, graphHash: input.rebind.graphHash, modelHash: revised.modelHash, accessScopes: input.rebind.accessScopes, reason: successor.revision.reason }); }
    catch (error) { return { ...common, modelHash: revised.modelHash, rebound: null, graphMutation: false, partial: true, failure: { stage: 'rebind', message: error.message }, nextStep: `The readings were applied but the rebind failed: rebind the graph to ${revised.modelHash}.` }; }
  }
  const small = report.filter((item) => item.moved <= 0.05).length;
  return { ...common, modelHash: revised.modelHash, revisionNumber: successor.revision.number, rebound, graphMutation: Boolean(rebound),
    nextStep: `${rebound ? 'The graph is rebound.' : 'Rebind the story graph to the revised model.'} ${small} of ${report.length} moved 0.05 or less. Where a rewrite moved a reading far, the prose may need to follow.` };
}

export function registerLensTools(server, service, { toolResult, estimator = null }) {
  server.registerTool('life_lens_define', {
    description: 'Define a lens: a way of seeing asked of many records, such as whether an act comes from fear or from love, or whether a person is wanting, bartering or standing for something. There are as many lenses as ways of understanding people and worlds; look for them in thinkers, traditions and disciplines, in the world being modeled, and invent the ones it needs. The lens is recorded as an Understanding Node of kind lens, linked to who or what it looks at. Its answers are Cuts on each record\'s Event with ids that begin lens.<id>., so they are weighted, keep a remainder, and can be estimated and drawn. Defining a lens with the same id again revises it: the new version supersedes the old, and answers keep their Cut ids. Asks nothing of the engine.',
    inputSchema: lensDefineSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await defineLens(service, input)));
  server.registerTool('life_lens_place', {
    description: 'Place lens readings beneath whoever holds them. An interpretation is not a fact of the world, so a reading does not sit on the record it reads: this adds the holder\'s understanding root (a context root of kind understanding) and one reading Event per record, contained by that root and linked about the record, and moves readings that still sit on the record onto their reading Event with the same Cut ids and weights. An actor\'s own reasons, as canon, go on an inner Event under the actor\'s inner root at the decision; a character\'s reading under that character\'s inner root. It lists the Cuts it could not move and the estimates to recheck.',
    inputSchema: lensPlaceSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await placeReadings(service, input)));
  server.registerTool('life_lens_reread', {
    description: 'Read again every stale lens reading of the records named, or of all records, across lenses, in one call: a reading is stale when its record was rewritten since it was read, or when it answered an earlier version of its lens. Each is asked the same question with the same answers and unit through the configured estimator, the lot applied in one model revision, and each reading\'s movement is reported, so a rewrite that changed nothing is seen to have changed nothing.',
    inputSchema: lensRereadSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await rereadLenses(service, estimator, input)));
  server.registerTool('life_lens_questions', {
    description: 'Ask every lens of the model: for each lens (defined with life_lens_define; in the storytelling profile fear or love is built in), the records it applies to that have no answer yet, with the question for each and the Cut id to answer it with; where a person\'s answer changes over their life and where it never does; and open questions that keep looking for lenses not yet found. Read-only.',
    inputSchema: lensQuestionsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await lensQuestions(service, input)));
}
