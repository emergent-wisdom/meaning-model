// Model the author before the world, and the world before the story. A book comes out of a life: the author's,
// modeled first with the wants that life taught them and the question they are working out by writing, and
// optionally an example reader's, modeled the same way. The world is chosen for what it lets that author figure
// out and what it presses in a reader, then modeled with the implications of its commitments followed through,
// and only then is a route chosen through a small part of it. This is the method the Book of Conditions was
// built with, preceded by the author, made into five recorded stages that scene preparation requires: the
// author and reader; candidate worlds tested for dramatic pressure and one chosen by argument; the chosen world
// opened in successive expansions; the implications of each commitment traced into the model; a route of parts.
import { resolveAppendHead } from './graph-head.mjs';
import * as z from 'zod/v4';
import { prepareAuthorRecord } from './storytelling-authoring.mjs';
import { anchoredModelRecord } from './construction-record.mjs';
import { readAuthorModel } from './storytelling-author-model.mjs';
import { cutKind, eventDescendants, indexModel, modeledPeople, modelJumps, modelQuestions, readOpenQuestions, readPerson, VISIBLE_QUESTIONS } from './model-questions.mjs';
import { interestInstructions, storyInterest, storyInterestIds } from './storytelling-interest.mjs';

export const WORLD_SCHEMA = 'meaning-model-story-world/v1';
const id = z.string().trim().min(1).max(256);
const text = (min = 1, max = 16_000) => z.string().trim().min(min).max(max);
const time = z.number().finite();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.string().trim().min(3).max(1_024).describe('A model record as kind:id (event:ev.x, process:p.x, cut:c.x, referent:r.x, concept:c.x) or a graph node id.');
const anchorKinds = { event: 'event', process: 'process', cut: 'normalized_cut', referent: 'referent', concept: 'concept', abstract_cut: 'abstract_cut', event_relation: 'event_relation', law: 'law', claim: 'claim' };
const modelReference = (ref) => {
  const colon = ref.indexOf(':');
  return colon > 0 ? { anchorKind: anchorKinds[ref.slice(0, colon)] ?? null, recordId: ref.slice(colon + 1) } : { anchorKind: null, recordId: ref };
};

// The author, and optionally a reader, are lives in their own models: the person template opened with periods,
// shocks and wants, as the characters' lives are. This record holds only what the lives do not: why this author
// writes this story, what they want to teach and figure out, and which buttons the story presses in its reader.
const life = {
  personId: id.describe('The referent of this person in their life model, compiled from the person template (person_scaffold).'),
  name: text(1, 200),
  mode: z.enum(['real', 'invented']).describe('A real person modeled from supplied or known evidence, or an invented person labelled as invented.'),
  lifeModelHash: hash.describe('The model holding the person\'s life: its own model, or the story\'s model with the person\'s reality as a realm of its own (a context root). Either way notes can link to its records: about targets may name records of any stored model.'),
};
const authorReaderStage = z.object({
  stage: z.literal('author_reader'),
  author: z.object({
    ...life,
    authorModelNodeId: id.describe('The stored author model (life_story_author_record, kind author_model): the voice this life produces. Its modeledAuthorId is personId.'),
    livesIn: z.enum(['this_world', 'separate_world']).describe('Does the author live in this story\'s world, or a separate one? A memoir or a story among the author\'s own people lives in this world; an invented world usually does not.'),
    writing: text(10, 4_000).nullable().default(null).describe('If the author lives in this world: when they write the book relative to the story\'s events, what they know then, and how far they stand from what they tell. It shapes what can be documented.'),
    whyThisStory: text(20, 4_000).describe('Why this person writes this story now, read from their modeled life.'),
    teach: text(3, 4_000).describe('What they want to teach or show; say so when nothing is settled.'),
    figuringOut: text(20, 4_000).describe('What they are figuring out by writing it: the question their own conflicting wants leave open.'),
    lifeRecords: z.array(reference).min(2).max(24).describe('The records of the author\'s life model this reasoning rests on (event:, cut:, process:).'),
  }).strict(),
  reader: z.object({
    ...life,
    situation: text(10, 4_000).describe('What is happening in their life when they read this book.'),
  }).strict().nullable().default(null).describe('An optional example reader, modeled as a life in the same way.'),
  buttons: z.array(z.object({
    id,
    button: text(5, 2_000).describe('The fear, longing, shame or hope the story presses, in words the reader might use.'),
    presses: text(10, 2_000).describe('How a story can press it.'),
    learns: text(10, 2_000).describe('What the reader could learn about their own life.'),
    readerRecords: z.array(reference).max(8).default([]).describe('The modeled reader\'s records it presses (cut:, event:, process:); required when a reader is modeled.'),
  }).strict()).min(1).max(8).describe('What this story attempts to press in its reader.'),
}).strict();

const principal = z.object({
  name: text(1, 200), wants: text(3, 2_000).describe('What they want, and where two of their wants conflict.'),
  interest: text(10, 2_000).describe('What makes this person interesting in this event: a contradiction, a want at odds with a need, a strength that becomes the flaw.'),
  readingOfShock: text(3, 2_000).describe('How this principal reads the central shock; a strong world has principals who read it differently.'),
}).strict();
const candidate = z.object({
  id, title: text(1, 300),
  world: text(10, 2_000).describe('The invented world, or the event in our world, the story lives in.'),
  account: text(200, 8_000).describe('One paragraph: the enclosing situation, what the principals want, the central shock, what it costs and how it ends.'),
  premise: text(10, 2_000).describe('The premise in a sentence or two: the situation that makes the story worth telling.'),
  emotionalCore: text(10, 2_000).describe('The human truth the premise touches and why a reader would feel it.'),
  question: text(10, 2_000).describe('What the history is about: the question it answers or the idea it tests.'),
  presses: z.array(z.object({ buttonId: id, how: text(10, 2_000) }).strict()).min(1).max(8).describe('Which buttons of the author_reader record this world presses, and how.'),
  authorStake: text(20, 4_000).describe('Where this world comes from in the author\'s life, and what writing it lets them figure out.'),
  longTermProcesses: z.array(text(10, 1_000)).min(2).max(12).describe('The most interesting processes of this world, often long-term (a career, an institution, a technology, a marriage, a decline), which the model will represent.'),
  centralShock: text(10, 2_000), principals: z.array(principal).min(2).max(8),
  costs: text(10, 4_000).describe('What each consequential choice costs, and who pays.'), outcome: text(10, 2_000),
}).strict();
const pressure = z.object({
  candidateId: id,
  choicesCost: text(3, 2_000), divergentReadings: text(3, 2_000),
  shockChanges: text(3, 2_000).describe('Whether the shock changes what principals want or believe, rather than confirming it.'),
  removableEpisode: text(3, 2_000).describe('Which episode could be removed without changing anything later, if any; removable episodes are weak.'),
  principalsPartlyRight: text(3, 2_000),
  premiseInterest: text(3, 2_000).describe('Would a reader want this story for its premise and emotional core alone? Compare it honestly with the other candidates.'),
  readerPull: text(3, 2_000).describe('Would the reader pick it up, keep reading, and learn something about their own life? Where would they put it down?'),
  verdict: z.enum(['strong', 'workable', 'weak']),
}).strict();
const candidatesStage = z.object({
  stage: z.literal('candidates'),
  authorReaderNodeId: id.nullable().default(null).describe('Optional: a record this one builds on. Stages can be recorded in any order and revised whenever the model leads back to them.'),
  form: z.object({ targetWords: z.number().int().min(300).max(300_000), parts: z.number().int().min(1).max(80) }).strict(),
  candidates: z.array(candidate).min(3).max(8),
  pressure: z.array(pressure).min(3).max(8),
  selection: z.object({ chosenId: id, reasons: text(20, 4_000), rejected: z.array(z.object({ candidateId: id, reason: text(10, 2_000) }).strict()).min(2).max(7) }).strict(),
}).strict();
const openingStage = z.object({
  stage: z.literal('opening'),
  candidatesNodeId: id.nullable().default(null).describe('Optional: a record this one builds on. Stages can be recorded in any order and revised whenever the model leads back to them.'),
  accounts: z.array(text(100, 30_000)).min(2).max(6)
    .describe('Successive expansions of the same history: the first in one paragraph, the next in two, and so on; each keeps or explicitly revises the claims above it.'),
  closedQuestions: z.array(text(10, 2_000)).min(3).max(80).describe('Commitments the opening settles: who, what, where, the quantities that must reconcile.'),
  revisions: z.array(z.object({ claim: text(3, 2_000), revisedTo: text(3, 2_000), reason: text(3, 2_000) }).strict()).max(40).default([]),
  era: z.object({
    kind: z.enum(['real', 'alternate', 'invented']).describe('Is the story set at a real time in the real world, in a history that departs from the real one at some point, or in an invented world?'),
    documentaryCutoff: text(4, 200).nullable().default(null).describe('For a real or alternate era: the date up to which the world is what the sources document. After it, the story invents.'),
    knowledgeLimit: text(4, 2_000).nullable().default(null).describe('Where your own knowledge of the era ends (training often stops before the story\'s time), and how you found out what happened since.'),
    livingPeople: text(4, 4_000).nullable().default(null).describe('The living people and real organizations the story would otherwise touch, and the invented people and companies that take their place; the real world stays in the background.'),
  }).strict().nullable().default(null).describe('Optional: the era, whether it is real, and if so what is documented and what is invented.'),
}).strict();
export const partsWithoutChoiceQuestion = (parts, total) => `${parts.length} of ${total} parts hold no decision the model draws (${parts.join(', ')}). Who chooses in each, between what, and why? Model the choices from the people's state at those moments, contain them in the part's Events, and draw them, so each part is caused by a choice as well as by what happens.`;

// The route as the model sees it: parts in which nobody chooses, principals with no shock inside the story's time, the
// largest jumps it leaves out without saying why, and aspects still open. Questions, not gates.
export function routeQuestions(model, route, { openAspects = [] } = {}) {
  if (!model || !route?.parts?.length) return [];
  const index = indexModel(model);
  const questions = [];
  const inside = (part) => new Set(part.eventIds.flatMap((eventId) => [eventId, ...eventDescendants(index, eventId)]));
  const withoutChoice = route.parts.filter((part) => {
    const events = inside(part);
    return !index.cuts.some((cut) => cutKind(cut) === 'decision' && events.has(cut.parent_event_id));
  }).map((part) => part.id);
  if (withoutChoice.length) questions.push({ kind: 'parts-without-choice', parts: withoutChoice, tool: 'life_model_revise, then life_direction_draw (record)', question: partsWithoutChoiceQuestion(withoutChoice, route.parts.length) });
  // Decisions withdrawn after the route was recorded leave it rendering a chain the model no longer holds.
  const rendered = new Set(route.parts.flatMap((part) => [...inside(part)]));
  const withdrawn = (model.meaning_model?.normalized_cuts ?? []).filter((cut) => cut.withdrawn && rendered.has(cut.parent_event_id));
  if (withdrawn.length) questions.push({ kind: 'route-withdrawn', cuts: withdrawn.map((cut) => cut.id), tool: 'life_story_world_record (stage route)',
    question: `The route renders ${withdrawn.length} decision${withdrawn.length === 1 ? '' : 's'} the model has since withdrawn (${withdrawn.slice(0, 4).map((cut) => cut.id).join(', ')}${withdrawn[0].withdrawn?.reason ? `: ${String(withdrawn[0].withdrawn.reason).slice(0, 200)}` : ''}). Record a route through what the model now holds.` });
  // The story's present runs from the first part's moment to the last one's: each part's shortest Event, leaving out
  // the backstory shocks and the whole lives and periods it also renders.
  const backstory = new Set([...index.arcsOf.values()].flat().flatMap((eventId) => [eventId, ...eventDescendants(index, eventId)]));
  const intervals = route.parts.map((part) => part.eventIds.filter((eventId) => !backstory.has(eventId)).map((eventId) => index.events.get(eventId)?.interval)
    .filter((interval) => typeof interval?.start === 'number').sort((a, b) => ((a.end ?? a.start) - a.start) - ((b.end ?? b.start) - b.start))[0]).filter(Boolean);
  if (intervals.length) {
    const first = Math.min(...intervals.map((interval) => interval.start));
    const last = Math.max(...intervals.map((interval) => interval.end ?? interval.start));
    const unshocked = modeledPeople(index).filter((person) => person.principal && !readPerson(index, person.id).arcs.some((item) => {
      const at = (item.focal ?? item.arc)?.interval?.start;
      return typeof at === 'number' && at >= first && at <= last;
    }));
    if (unshocked.length) questions.push({ kind: 'story-shock-missing', subjects: unshocked.map((person) => person.id), tool: 'life_profile_compile (change_arc_scaffold) or life_model_revise',
      question: `${unshocked.map((person) => person.name).join(', ')} ${unshocked.length === 1 ? 'has' : 'have'} no shock inside the story's time (${+first.toFixed(4)} to ${+last.toFixed(4)}); the model's shocks for ${unshocked.length === 1 ? 'them' : 'each'} are all earlier. Which Event in the story changes what each wants, how do they anticipate it, and how do they adapt? Open a change arc for it, with Cuts of what they want and feel after it.` });
  }
  const { jumps } = modelJumps(model, { limit: 5 });
  const missed = jumps.filter((jump) => !jump.eventIds.some((eventId) => rendered.has(eventId)));
  if (missed.length && !route.whyNotJumps) questions.push({ kind: 'jumps-unrendered', tool: 'life_story_world_record (stage route)',
    question: `The route leaves out ${missed.length} of the model's ${jumps.length} largest jumps (${missed.slice(0, 3).map((jump) => jump.what).join(' ')}) and does not say why. Route through them, or record in whyNotJumps why the story is elsewhere.` });
  if (openAspects.length) questions.push({ kind: 'aspects-open', tool: 'life_model_revise, then life_story_world_record (stage aspects)',
    question: `${openAspects.length} aspect${openAspects.length === 1 ? ' is' : 's are'} still open (${openAspects.slice(0, 8).map((item) => item.id ?? item).join(', ')}${openAspects.length > 8 ? ', and more' : ''}). Investigate them by modeling before the scenes that need them, and record a revised aspects list.` });
  return questions;
}

// Decisions drawn after the world was recorded may have changed what it teaches, and the director held an earlier
// world: both are asked again rather than assumed to still hold.
export function drawnSinceQuestions(view, world) {
  const draws = (view?.nodes ?? []).filter((node) => node.node_type === 'direction_draw');
  const since = (node) => (node ? draws.filter((draw) => (draw.value_time ?? 0) > (node.value_time ?? Infinity)).length : 0);
  const questions = [];
  const meaning = since(world.authorReader?.node);
  if (meaning) questions.push({ kind: 'world-after-draws', tool: 'life_story_world_record', question: `${meaning} decision${meaning === 1 ? ' was' : 's were'} drawn after the author and the buttons were recorded. Does what the story teaches and presses in its reader still hold? Re-read the author, the buttons and the aspects against what the model now holds, and record revised stages where they changed.` });
  const directed = (view?.nodes ?? []).filter((node) => node.node_type === 'storytelling.direction' && (() => { try { return JSON.parse(node.text)?.data?.stage === 'world'; } catch { return false; } })())
    .sort((a, b) => (b.value_time ?? 0) - (a.value_time ?? 0))[0];
  const after = since(directed);
  if (after) questions.push({ kind: 'direction-after-draws', tool: 'life_story_direct', question: `${after} decision${after === 1 ? ' was' : 's were'} drawn after the director last held the world. The world it judged has changed: hold it again before the scenes those draws shape.` });
  return questions;
}

// A real era is documented up to a cutoff and invented after it. These ask for what the opening has not stated;
// they are questions, not gates.
export function eraQuestions(opening) {
  if (!opening) return [];
  const era = opening.era ?? null;
  if (!era) return [{ kind: 'era-unstated', tool: 'life_story_world_record', question: 'Is this story set at a real time in the real world, in a history that departs from the real one, or in an invented world? Record it as the opening\'s era.' }];
  if (era.kind === 'invented') return [];
  return [
    ...(era.documentaryCutoff ? [] : [{ kind: 'era-cutoff', tool: 'life_story_world_record', question: 'The era is real: up to which date is the world what the sources document, and after which does the story invent? Record the documentary cutoff.' }]),
    ...(era.knowledgeLimit ? [] : [{ kind: 'era-knowledge', tool: 'life_understanding_record', question: 'Where does your own knowledge of this era end? Training often stops before the story\'s time. Find out what happened since with whatever research tools you have, record each documented fact as a report with its source (life_understanding_record, kind report) linked to the model records it grounds, and leave open what you cannot find rather than guessing it.' }]),
    ...(era.livingPeople ? [] : [{ kind: 'era-living-people', tool: 'life_story_world_record', question: 'Which living people and real organizations would this story touch? Invent the people and companies that take their place, and keep the real world in the background.' }]),
  ];
}
// Every element of what makes a story interesting (storytelling-interest.mjs), found where it lives in this story
// and investigated by modeling, with each principal's flaw among them. The list is revised as the model deepens: a
// later aspects record supersedes the earlier one.
const aspectsStage = z.object({
  stage: z.literal('aspects'),
  openingNodeId: id.nullable().default(null).describe('Optional: a record this one builds on. Stages can be recorded in any order and revised whenever the model leads back to them.'),
  aspects: z.array(z.object({
    id, kind: z.enum([...storyInterestIds, 'other']).describe('The element of the catalog of what makes a story interesting this aspect investigates.'),
    aspect: text(10, 2_000).describe('Where the element lives in this story: whose flaw, which choice, which object, which institution.'),
    category: text(2, 200).optional().describe('For kind other: your own name for this element, a category no list names.'),
    why: text(10, 2_000).optional().describe('For kind other: why it makes this story interesting.'),
    how: text(10, 4_000).describe('How to investigate it by modeling: create new processes, refine existing ones, open sub-processes, add earlier Events that explain or later Events that follow (a childhood, a war a century back, a consequence years on), add Cuts and estimate them, draw decisions, name the concepts and laws things instantiate, model how Things work and where everything is, try another decomposition, sample trajectories.'),
    status: z.enum(['modeled', 'opening', 'open']),
    records: z.array(reference).max(32).default([]).describe('The model records that answer it so far.'),
  }).strict()).min(20).max(200),
}).strict();
const implication = z.object({
  about: text(1, 300).describe('Whom or what it affects: a principal, a relationship, an institution, money, time, a later Event.'),
  consequence: text(10, 4_000),
  status: z.enum(['represented', 'remainder', 'open']),
  representedBy: z.array(reference).max(16).default([]),
  reason: text(3, 2_000).nullable().default(null).describe('For remainder: why it may stay unrepresented.'),
}).strict();
const implicationsStage = z.object({
  stage: z.literal('implications'),
  openingNodeId: id.nullable().default(null).describe('Optional: a record this one builds on. Stages can be recorded in any order and revised whenever the model leads back to them.'),
  commitments: z.array(z.object({ id, commitment: text(10, 4_000), implications: z.array(implication).min(1).max(24) }).strict()).min(3).max(80),
}).strict();
const routeStage = z.object({
  stage: z.literal('route'),
  implicationsNodeId: id.nullable().default(null).describe('Optional: a record this one builds on. Stages can be recorded in any order and revised whenever the model leads back to them.'),
  parts: z.array(z.object({
    id, title: text(1, 300), eventIds: z.array(id).min(1).max(24),
    focal: text(3, 2_000).describe('Whose route through the Events the part follows.'),
    change: text(10, 4_000).describe('What is different at the end of the part.'), ends: text(3, 2_000),
  }).strict()).min(1).max(80),
  renderedOrder: text(10, 4_000).describe('Why the parts come in this order, which need not be the chronology.'),
  whyNotJumps: text(20, 4_000).nullable().default(null).describe('Required only when the route renders none of the model\'s largest jumps: why the story is elsewhere.'),
  risks: z.array(z.object({ risk: text(10, 2_000), repair: text(10, 2_000) }).strict()).min(1).max(20),
}).strict();

export const worldRecordSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u), requestId: id, nodeId: id, storyRootId: id, authorId: id, exactRevision: z.boolean().default(false).describe('Write against graphHash exactly, creating a branch if it is not the newest revision. By default an add-only record goes to the newest head.'),
  accessScopes: z.array(id).min(1).max(64),
  summary: text(10, 4_000).describe('A few sentences a later reader sees first.'),
  world: z.discriminatedUnion('stage', [authorReaderStage, candidatesStage, openingStage, aspectsStage, implicationsStage, routeStage]),
}).strict();

// Stored world records of a story, the latest of each stage that no later record supersedes.
export function readWorldState(view, storyRootId) {
  const superseded = new Set((view.edges ?? []).filter((edge) => edge.relation === 'supersedes' && edge.target?.kind === 'node').map((edge) => edge.target.node_id));
  const latest = {};
  for (const node of view.nodes ?? []) {
    if (node.node_type !== 'storytelling.world' || node.subject !== storyRootId || superseded.has(node.id)) continue;
    let payload; try { payload = JSON.parse(node.text); } catch { continue; }
    const data = payload?.data;
    if (data?.schema !== WORLD_SCHEMA) continue;
    const current = latest[data.stage];
    if (!current || (node.value_time ?? 0) >= (current.node.value_time ?? 0)) latest[data.stage] = { node, data };
  }
  const openImplications = (latest.implications?.data.commitments ?? []).flatMap((commitment) => commitment.implications
    .filter((item) => item.status === 'open').map((item) => ({ commitmentId: commitment.id, about: item.about })));
  const openAspects = (latest.aspects?.data.aspects ?? []).filter((item) => item.status !== 'modeled').map((item) => ({ id: item.id, kind: item.kind, aspect: item.aspect, status: item.status }));
  return { authorReader: latest.author_reader ?? null, candidates: latest.candidates ?? null, opening: latest.opening ?? null, aspects: latest.aspects ?? null,
    implications: latest.implications ?? null, route: latest.route ?? null, openImplications, openAspects };
}
export const worldStages = Object.freeze([['authorReader', 'author_reader'], ['candidates', 'candidates'], ['opening', 'opening'], ['aspects', 'aspects'], ['implications', 'implications']]);

const paragraphs = (value) => value.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean).length;
// Longer works need more successive openings before their route: two up to 2,500 words, three to 7,500, then four.
export const requiredOpenings = (targetWords) => (targetWords <= 2_500 ? 2 : targetWords <= 7_500 ? 3 : 4);

// The record a stage builds on: the one it names, or the latest of that stage if any exists. Stages are recorded
// in any order, so a missing one is not an error; checks that need it wait until it exists.
function relatedStage(view, nodeId, storyRootId, stage) {
  if (nodeId) return stageNode(view, nodeId, storyRootId, stage);
  const latest = readWorldState(view, storyRootId)[{ author_reader: 'authorReader' }[stage] ?? stage];
  return latest ? { node: latest.node, data: latest.data } : { node: null, data: null };
}

function stageNode(view, nodeId, storyRootId, stage) {
  const node = view.nodes.find((item) => item.id === nodeId);
  let data = null; try { data = JSON.parse(node?.text ?? '').data; } catch { data = null; }
  if (!node || node.node_type !== 'storytelling.world' || node.subject !== storyRootId || data?.schema !== WORLD_SCHEMA || data.stage !== stage) {
    throw new Error(`${nodeId} is not a stored ${stage} world record of this story.`);
  }
  return { node, data };
}

// A person's life must be a stored model that holds them. How the life is expressed is the modeler's choice, since
// the model is a language; its open questions come back with the record.
async function readLife(service, who, person, records = []) {
  const inspected = await service.inspectModel({ modelHash: person.lifeModelHash, includeDefinition: true }).catch(() => null);
  const model = inspected?.model;
  if (!model) throw new Error(`The ${who}'s life model ${person.lifeModelHash} is not a stored model; model the life first (life_model_register, then life_model_revise as it deepens).`);
  if (!anchoredModelRecord(model, 'referent', person.personId, person.lifeModelHash)) throw new Error(`${person.personId} is not a referent of the ${who}'s life model.`);
  const questions = modelQuestions(model, { people: [{ id: person.personId, name: person.name, principal: true }], limit: 500 });
  for (const ref of records) {
    const { anchorKind, recordId } = modelReference(ref);
    if (!anchorKind || !anchoredModelRecord(model, anchorKind, recordId, person.lifeModelHash)) throw new Error(`The ${who} cites ${ref}, which is not a record (kind:id) of their life model.`);
  }
  return questions;
}

// Validates a stage against the records before it; returns the links to them.
async function validateStage(service, world, view, input, model, modelHash) {
  const links = [];
  const extra = {};
  if (world.stage === 'author_reader') {
    if (world.author.livesIn === 'this_world' && !world.author.writing) throw new Error('The author lives in this world, so when they write the book matters: say when, relative to the story\'s events, what they know then, and how far they stand from what they tell (author.writing).');
    const authorQuestions = await readLife(service, 'author', world.author, world.author.lifeRecords);
    let readerQuestions = null;
    if (world.reader) readerQuestions = await readLife(service, 'reader', world.reader, world.buttons.flatMap((item) => item.readerRecords));
    const { model: voice } = readAuthorModel(view, { nodeId: world.author.authorModelNodeId, storyRootId: input.storyRootId });
    if (voice.modeledAuthorId !== world.author.personId) {
      throw new Error(`The author model ${world.author.authorModelNodeId} models ${voice.modeledAuthorId}, not ${world.author.personId}; the voice must be the voice of this life.`);
    }
    if ((voice.mode === 'real_author') !== (world.author.mode === 'real')) throw new Error('The author model and the author\'s life must agree on whether the author is real or invented.');
    const buttonIds = world.buttons.map((item) => item.id);
    if (new Set(buttonIds).size !== buttonIds.length) throw new Error('Button ids must be unique.');
    for (const button of world.buttons) {
      if (world.reader && !button.readerRecords.length) throw new Error(`Button ${button.id} must name the records of the modeled reader's life it presses.`);
      if (!world.reader && button.readerRecords.length) throw new Error(`Button ${button.id} names reader records, but no reader is modeled.`);
    }
    links.push({ relation: 'about', targetNodeId: world.author.authorModelNodeId });
    extra.lives = { author: { total: authorQuestions.total, questions: authorQuestions.questions.slice(0, 6) },
      reader: readerQuestions ? { total: readerQuestions.total, questions: readerQuestions.questions.slice(0, 4) } : null };
  }
  if (world.stage === 'candidates') {
    const { node: authorNode, data: authorReader } = relatedStage(view, world.authorReaderNodeId, input.storyRootId, 'author_reader');
    if (authorNode) links.push({ relation: 'refines', targetNodeId: authorNode.id });
    const ids = world.candidates.map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error('Candidate world ids must be unique.');
    if (authorReader) {
      const buttonIds = new Set(authorReader.buttons.map((item) => item.id));
      for (const item of world.candidates) for (const press of item.presses) {
        if (!buttonIds.has(press.buttonId)) throw new Error(`Candidate ${item.id} presses ${press.buttonId}, which is not a button of the author_reader record (${[...buttonIds].join(', ')}).`);
      }
    }
    const assessed = world.pressure.map((item) => item.candidateId);
    if (new Set(assessed).size !== assessed.length || ids.some((candidateId) => !assessed.includes(candidateId)) || assessed.some((candidateId) => !ids.includes(candidateId))) {
      throw new Error('Give exactly one pressure test for every candidate world.');
    }
    if (!ids.includes(world.selection.chosenId)) throw new Error(`The chosen world ${world.selection.chosenId} is not among the candidates.`);
    const rejected = world.selection.rejected.map((item) => item.candidateId);
    const others = ids.filter((candidateId) => candidateId !== world.selection.chosenId);
    if (rejected.length !== others.length || others.some((candidateId) => !rejected.includes(candidateId))) throw new Error('Give a reason for rejecting every other candidate world.');
    if (world.pressure.find((item) => item.candidateId === world.selection.chosenId).verdict === 'weak') {
      throw new Error('The chosen world failed its own pressure test; revise it into a stronger candidate or choose another.');
    }
    const chosen = world.candidates.find((item) => item.id === world.selection.chosenId);
    if (new Set(chosen.principals.map((item) => item.readingOfShock.toLowerCase())).size < 2) {
      throw new Error('In the chosen world every principal reads the central shock the same way; a world with pressure needs divergent readings.');
    }
  }
  if (world.stage === 'opening') {
    const { node, data } = relatedStage(view, world.candidatesNodeId, input.storyRootId, 'candidates');
    if (node) links.push({ relation: 'refines', targetNodeId: node.id });
    world.accounts.forEach((account, index) => {
      if (paragraphs(account) < index + 1) throw new Error(`Opening ${index + 1} has ${paragraphs(account)} paragraph(s); each expansion adds a paragraph (${index + 1} expected), with blank lines between paragraphs.`);
    });
    const needed = requiredOpenings(data?.form.targetWords ?? 0);
    if (world.accounts.length < needed) throw new Error(`A work of about ${data?.form.targetWords ?? 'this'} words needs at least ${needed} successive openings of its world; this has ${world.accounts.length}.`);
    extra.interestCatalog = storyInterest;
    extra.eraQuestions = eraQuestions(world);
  }
  if (world.stage === 'aspects') {
    const { node } = relatedStage(view, world.openingNodeId, input.storyRootId, 'opening');
    if (node) links.push({ relation: 'refines', targetNodeId: node.id });
    const aspectIds = world.aspects.map((item) => item.id);
    if (new Set(aspectIds).size !== aspectIds.length) throw new Error('Aspect ids must be unique.');
    const missing = storyInterest.filter((element) => !world.aspects.some((item) => item.kind === element.id));
    if (missing.length) throw new Error(`Find where each element of what makes a story interesting lives in this story, and investigate it: ${missing.map((element) => `${element.id} (${element.element})`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. An element that turns out absent is still investigated; say what the model showed.`);
    const own = world.aspects.filter((item) => item.kind === 'other');
    if (!own.length) throw new Error('The catalog is a beginning, not a boundary: add at least one aspect of kind other, an element that makes this story interesting that no list names, with its category and why.');
    const unnamed = own.filter((item) => !item.category || !item.why);
    if (unnamed.length) throw new Error(`Give each element of your own its category and why: ${unnamed.map((item) => item.id).join(', ')}.`);
    const { data: opening } = relatedStage(view, world.openingNodeId, input.storyRootId, 'opening');
    const { data: chosen } = relatedStage(view, opening?.candidatesNodeId ?? null, input.storyRootId, 'candidates');
    const principals = chosen?.candidates.find((item) => item.id === chosen.selection.chosenId)?.principals ?? [];
    const withoutFlaw = principals.filter((principal) => !world.aspects.some((item) => item.kind === 'flaws' && item.aspect.toLowerCase().includes(principal.name.toLowerCase())));
    if (withoutFlaw.length) throw new Error(`Investigate each principal's flaw as a process over their life: ${withoutFlaw.map((principal) => principal.name).join(', ')} ${withoutFlaw.length === 1 ? 'has' : 'have'} no flaws aspect naming them.`);
    for (const item of world.aspects) {
      if (item.status === 'modeled' && !item.records.length) throw new Error(`Aspect ${item.id} is marked modeled but names no model record that answers it.`);
      for (const ref of item.records) {
        const { anchorKind, recordId } = modelReference(ref);
        if (anchorKind) {
          if (!model) throw new Error('Aspects that cite model records need a model-bound story graph.');
          if (!anchoredModelRecord(model, anchorKind, recordId, modelHash)) throw new Error(`Aspect ${item.id} cites ${ref}, which is not a record of the bound model.`);
        } else if (!view.nodes.some((graphNode) => graphNode.id === ref)) throw new Error(`Aspect ${item.id} cites ${ref}, which is neither a model record (kind:id) nor a graph node.`);
      }
    }
    extra.openAspects = world.aspects.filter((item) => item.status !== 'modeled').map((item) => item.id);
  }
  if (world.stage === 'implications') {
    const { node } = relatedStage(view, world.openingNodeId, input.storyRootId, 'opening');
    if (node) links.push({ relation: 'refines', targetNodeId: node.id });
    const commitmentIds = world.commitments.map((item) => item.id);
    if (new Set(commitmentIds).size !== commitmentIds.length) throw new Error('Commitment ids must be unique.');
    for (const commitment of world.commitments) for (const item of commitment.implications) {
      if (item.status === 'represented' && !item.representedBy.length) throw new Error(`An implication of ${commitment.id} is marked represented but names no record that represents it.`);
      if (item.status === 'remainder' && !item.reason) throw new Error(`An implication of ${commitment.id} left as remainder needs the reason it may stay unrepresented.`);
      for (const ref of item.representedBy) {
        const { anchorKind, recordId } = modelReference(ref);
        if (anchorKind) {
          if (!model) throw new Error('Implications that cite model records need a model-bound story graph.');
          if (!anchoredModelRecord(model, anchorKind, recordId, modelHash)) throw new Error(`Implication of ${commitment.id} cites ${ref}, which is not a record of the bound model.`);
        } else if (!view.nodes.some((graphNode) => graphNode.id === ref)) throw new Error(`Implication of ${commitment.id} cites ${ref}, which is neither a model record (kind:id) nor a graph node.`);
      }
    }
  }
  if (world.stage === 'route') {
    const { node, data } = relatedStage(view, world.implicationsNodeId, input.storyRootId, 'implications');
    if (node) links.push({ relation: 'refines', targetNodeId: node.id });
    const open = (data?.commitments ?? []).flatMap((commitment) => commitment.implications.filter((item) => item.status === 'open').map(() => commitment.id));
    if (open.length) extra.openImplicationsAtRoute = [...new Set(open)];
    const partIds = world.parts.map((item) => item.id);
    if (new Set(partIds).size !== partIds.length) throw new Error('Route part ids must be unique.');
    if (!model) throw new Error('A route names Events of the bound model; the story graph must be model-bound.');
    for (const part of world.parts) for (const eventId of part.eventIds) {
      const event = (model.meaning_model?.events ?? []).find((item) => item.id === eventId);
      if (!event) throw new Error(`Route part ${part.id} names ${eventId}, which is not an Event of the bound model.`);
      if (!String(event.description ?? '').trim()) throw new Error(`Route part ${part.id} renders Event ${eventId}, which has no description; describe what happens in it first.`);
    }
    // The story is where the model jumps: a route that renders none of the largest jumps must say why.
    const { jumps } = modelJumps(model, { limit: 5 });
    const index = indexModel(model);
    const rendered = new Set(world.parts.flatMap((part) => part.eventIds.flatMap((eventId) => [eventId, ...eventDescendants(index, eventId)])));
    const renderedJumps = jumps.filter((jump) => jump.eventIds.some((eventId) => rendered.has(eventId)));
    if (jumps.length && !renderedJumps.length && !world.whyNotJumps) {
      throw new Error(`The route renders none of the model's largest jumps (${jumps.slice(0, 3).map((jump) => jump.what).join(' ')}). The story is a consequence of the model: route through them, or say in whyNotJumps why the story is elsewhere.`);
    }
    extra.jumps = { largest: jumps, rendered: renderedJumps.length };
    extra.routeQuestions = routeQuestions(model, world, { openAspects: readWorldState(view, input.storyRootId).openAspects });
  }
  return { links, extra };
}

export async function storeWorldRecord(service, raw) {
  const input = worldRecordSchema.parse(raw);
  const head = await resolveAppendHead(service, input.graphHash, input.requestId, input.exactRevision);
  input.graphHash = head.graphHash;
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.accessScopes)].sort() });
  const modelHash = view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
  const model = modelHash ? (await service.inspectModel({ modelHash, includeDefinition: true })).model : null;
  const { links, extra } = await validateStage(service, input.world, view, input, model, modelHash);
  const routeEvents = input.world.stage === 'route' ? [...new Set(input.world.parts.flatMap((part) => part.eventIds))].slice(0, 32) : [];
  const record = await prepareAuthorRecord(service, { graphHash: input.graphHash, requestId: input.requestId, nodeId: input.nodeId, exactRevision: true,
    storyRootId: input.storyRootId, authorId: input.authorId, accessScopes: input.accessScopes, kind: 'world', text: input.summary,
    data: { schema: WORLD_SCHEMA, ...input.world }, links, about: routeEvents.map((eventId) => ({ record: `event:${eventId}` })) });
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: record.narrativeBatch });
  const after = await service.queryNarrativeGraph({ graphHash: stored.graphHash, expectedGraphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.accessScopes)].sort() });
  const state = readWorldState(after, input.storyRootId);
  // Suggestions, not a sequence: any stage can come next, and the model's questions may lead elsewhere.
  const next = { author_reader: 'Perhaps candidate worlds that come out of this author\'s life and press these buttons (stage candidates), or wherever the model\'s questions lead.',
    candidates: 'Open the chosen world in successive expansions (stage opening).', opening: 'List every aspect of the story you could understand better, then investigate each by modeling (stage aspects).',
    aspects: 'Investigate the open aspects by modeling, recording a revised aspects list as they deepen, and trace the implications of each commitment into the model (stage implications).',
    implications: state.openImplications.length ? 'Resolve the open implications, then choose the route (stage route).' : 'Choose the route of parts through the world (stage route).',
    route: 'Prepare scenes for the route parts; name each scene\'s routePartId.' }[input.world.stage];
  const authorRecord = state.authorReader?.data.author ?? null;
  const author = authorRecord ? { id: authorRecord.personId, name: authorRecord.name, lifeModelHash: authorRecord.lifeModelHash } : null;
  const openQuestions = modelHash ? await readOpenQuestions(service, { modelHash, graphHash: stored.graphHash, accessScopes: input.accessScopes, limit: VISIBLE_QUESTIONS, author }).catch(() => null) : null;
  return { ...stored, ...record.receipt, ...(head.advancedFrom ? { advancedFrom: head.advancedFrom } : {}), schema: 'meaning-model-story-world-record/v1', stage: input.world.stage, worldNodeId: input.nodeId,
    openImplications: state.openImplications, ...extra, worldQuestions: drawnSinceQuestions(after, state), openQuestions: openQuestions && { total: openQuestions.total, questions: openQuestions.questions, jumps: openQuestions.jumps.slice(0, 5), alwaysAsk: openQuestions.alwaysAsk },
    nextStep: next, semanticVerification: false };
}

export const worldInstructions = `Use the model for all of it. Investigate who the author is, and who the book is for (stage author_reader). Investigate which worlds this author could write, and choose one by argument (candidates). Investigate the chosen world, opening it in successive accounts (opening). Investigate everything that makes this story interesting, the returned catalog as a start (aspects). Investigate what each commitment implies (implications). Investigate where in the model the story is (route). Ask whether the author lives in this world or a separate one; if in this one, when they write the book matters. Their life can be a model of its own or a realm of the story's, and notes can link records of any stored model, so hold what the author lived together with what it shapes. These come in any order and again whenever the model leads back to them; record each with life_story_world_record when the understanding happens, let the director (life_story_direct) hold the world and the draft to what makes a story good, and write each scene from the model's state at its moment.`;
