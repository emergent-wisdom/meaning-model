// Story chat: the user plays one character inside a story's world and the calling LLM plays the world and everyone
// else. Each chat is its own narrative graph bound to the story's model, so play never writes into a book's graph.
// What a character may use is read from the model by allowlist: their state up to now and the facts declared known to
// them by now, never the model's future, another person's inner state or an Event's description.
import * as z from 'zod/v4';
import { resolveAppendHead } from './graph-head.mjs';
import { cutKind, displayName, eventDescendants, indexModel, modeledPeople, processValuesAt, readPerson } from './model-questions.mjs';
import { viewpointAvailability } from './storytelling-disclosure.mjs';
import { minOf, maxOf } from './arrays.mjs';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.number().finite();
const scopes = z.array(id).min(1).max(64);
const text = z.string().min(1).max(64_000).refine((value) => value.trim().length > 0, 'Chat text must not be blank.');
const MAX_INPUT_BYTES = 256 * 1024;
const VOICE = /speech|speak|voice|diction|register|dialect|accent|talk|phrasing/iu;
const SETUP_SCHEMA = 'meaning-model-story-chat/v1';
const TURN_SCHEMA = 'meaning-model-story-chat-turn/v1';
const MESSAGE_SCHEMA = 'meaning-model-story-chat-message/v1';
const PROVENANCE = 'Meaning Model story chat v1';

const factSchema = z.object({
  id,
  text: z.string().trim().min(1).max(4_000),
  at: time.describe('World time from which the fact holds; nobody can know it earlier.'),
  groundedIn: z.array(id).max(16).default([]).describe('Model Events the fact concerns.'),
}).strict();
const learnedSchema = z.object({
  personId: id,
  factId: id,
  at: time.describe('World time from which this person knows the fact.'),
}).strict();
const book = z.enum(['chat_only', 'book']);

export const chatOpenSchema = z.object({
  requestId: id,
  chatId: id.describe('Stable ID for this chat; also the ID of its record node.'),
  title: z.string().trim().min(1).max(400),
  modelHash: hash.nullable().default(null).describe('The model the chat plays in. Omit when fromStory names a story graph; its bound model is used.'),
  fromStory: z.object({ graphHash: hash, rootId: id }).strict().nullable().default(null)
    .describe('The story this chat branches from. Its graph is only read, never written.'),
  player: z.object({ personId: id }).strict().describe('The character the user plays: a modeled person whose life contains startTime.'),
  playerId: id.default('player').describe('Who the user is, as holder of their own lines.'),
  agentId: id.describe('Who you are, as holder of the world\'s and the other characters\' lines.'),
  startTime: time,
  book,
  facts: z.array(factSchema).max(100).default([]),
  knows: z.array(learnedSchema).max(400).default([]).describe('What each person already knows when the chat begins.'),
  accessScopes: scopes,
}).strict();

export const chatPrepareSchema = z.object({
  graphHash: hash,
  chatId: id,
  worldTime: time,
  present: z.array(id).max(32).default([]).describe('People present besides the user\'s character.'),
  settingEventId: id.nullable().default(null).describe('The model Event the exchange takes place in, if any.'),
  horizon: z.number().finite().positive().default(1).describe('How far ahead, in model time units, the narrator reads the modeled course and open choices.'),
  recent: z.number().int().min(0).max(40).default(6),
  accessScopes: scopes,
}).strict();

export const chatRecordSchema = z.object({
  graphHash: hash,
  requestId: id,
  chatId: id,
  worldTime: time,
  worldTimeEnd: time.nullable().default(null),
  present: z.array(id).max(32).default([]),
  settingEventId: id.nullable().default(null),
  player: z.object({ text }).strict().describe('The user\'s exact words and acts, recorded as theirs.'),
  reply: z.object({ text }).strict().describe('Your exact reply, recorded as yours.'),
  events: z.array(id).max(64).default([]).describe('Model Events this exchange produced or renders, added with life_model_revise and bound with life_narrative_rebind.'),
  draws: z.array(id).max(16).default([]).describe('direction_draw records in this chat graph whose outcomes this turn played.'),
  facts: z.array(factSchema).max(32).default([]),
  learned: z.array(learnedSchema).max(64).default([]),
  book: book.nullable().default(null).describe('Change whether a book is wanted, from this turn on.'),
  accessScopes: scopes,
}).strict();

export const chatInstructions = `Story chat: the user plays one character inside the story's world, and you play the world and everyone else. Unless the user already said, ask two things first: who they are, a person already in the story or a new one; and whether they want a book from the play. "Chat only" keeps it interactive fiction. "Book" lets you write chapters from what was played, at any point. A new character needs a whole life in the model before play starts, built like any principal's (a life Event from birth, the slow processes, periods, what they want and feel, how they speak), so that they belong to the world. Only the user decides what that character says and does.
Open the chat with life_story_chat_open. It registers a separate chat graph bound to the story's model, so the play never writes into the book's own graph. Each turn, call life_story_chat_prepare with the world time, who is present and the setting; answer from what it returns; then call life_story_chat_record with the user's exact words and your exact reply. An ordinary exchange needs only these two calls.
Play each character from their own packet: their state now and the facts declared known to them by now. The world section is yours as narrator: the modeled course ahead (what the model or the book had, which the play may change) and the open choices. No character may use the world section, another person's packet or the model's future. Never speak or act for the user's character.
Where an outcome could go either way and the model holds the choice as a decision Cut, draw it with life_direction_draw recorded in the chat graph (rootId: the chat's story root) and play the drawn answer. A drawn outcome stays drawn: a reroll cannot enter the chat. When the play changes the world (something happens, someone learns something, a feeling or a relationship moves), put it in the model: Events with life_model_revise, then life_narrative_rebind for the chat graph, and list them in the turn record. Record what someone learns as a fact and a learned declaration, so that later turns know who knows it. Time moves forward between turns, never back.
If the user wants a book, write chapters through the scene workflow on the chat graph's story root, with the user's character as one viewpoint, and carry the chat's knowledge declarations into scene.context as viewpointKnownAt.`;

const parse = (value) => { try { return JSON.parse(value); } catch { return null; } };
const start = (event) => event?.interval?.start ?? null;
const end = (event) => event?.interval?.end ?? null;
const sortedScopes = (values) => [...new Set(values)].sort();
const endpoint = (nodeId) => ({ kind: 'node', node_id: nodeId });
const anchor = (eventId) => ({ kind: 'anchor', anchor_kind: 'event', anchor_id: eventId });
function bounded(raw, label) {
  if (Buffer.byteLength(JSON.stringify(raw ?? null)) > MAX_INPUT_BYTES) throw new Error(`${label} exceeds 256 KiB.`);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}

async function boundModel(service, modelHash) {
  const inspected = await service.inspectModel({ modelHash, includeDefinition: true });
  if (!inspected?.model) throw new Error(`Model ${modelHash.slice(0, 12)} is unknown.`);
  return inspected.model;
}

// The person's own life must hold the moment: nobody plays or meets someone before birth or after death.
function lifeAt(index, personId, t) {
  const referent = index.referents.get(personId);
  if (!referent) throw new Error(`${personId} is not a referent in the chat's model.`);
  const life = referent.lifecycle_event_id ? index.events.get(referent.lifecycle_event_id) ?? null : null;
  if (!life) return { life: null, alive: false, reason: `${personId} has no life Event in the model.` };
  const born = start(life), died = end(life);
  const alive = (born === null || born <= t) && (died === null || died >= t);
  return { life, alive, reason: alive ? null : `${displayName(personId)}'s modeled life (${born ?? '?'} to ${died ?? '?'}) does not contain ${t}.` };
}

// The chat's record node, its knowledge declarations and its turns, from the chat graph.
function readChat(view, chatId) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const record = nodes.get(chatId);
  const setup = record?.node_type === 'storytelling.chat' ? parse(record.text) : null;
  if (setup?.schema !== SETUP_SCHEMA) throw new Error(`${chatId} is not a story chat in this graph. Open one with life_story_chat_open.`);
  const turns = view.nodes.filter((node) => node.node_type === 'storytelling.chat_turn').map((node) => parse(node.text))
    .filter((turn) => turn?.schema === TURN_SCHEMA && turn.chatId === chatId).sort((a, b) => a.turn - b.turn);
  const messages = new Map(view.nodes.filter((node) => node.node_type === 'storytelling.chat_message')
    .map((node) => [node.id, parse(node.text)]).filter(([, payload]) => payload?.schema === MESSAGE_SCHEMA));
  const knows = [...setup.knows, ...turns.flatMap((turn) => turn.learned)];
  const bookChoice = turns.reduce((choice, turn) => turn.book ?? choice, setup.book);
  return { nodes, setup, turns, messages, knows, book: bookChoice, lastTime: turns.at(-1)?.worldTime ?? setup.startTime };
}

// A draw entered the chat once: the first draw over a Cut stands, and a later one is a reroll the chat never plays.
function chatDraws(view) {
  const byCut = new Map();
  for (const node of view.nodes.filter((item) => item.node_type === 'direction_draw')) {
    const draw = parse(node.text);
    if (!draw?.cutId) continue;
    const entry = byCut.get(draw.cutId) ?? { first: null, rerolls: [] };
    if (draw.reroll) entry.rerolls.push(node.id); else entry.first = { nodeId: node.id, realized: draw.realized, question: draw.question };
    byCut.set(draw.cutId, entry);
  }
  return byCut;
}

// Labels are the modeler's names and often carry an end date ("Nursing and Kieran, 2013-2020"). Inside a character's
// packet, a number that could be a later time in this model is hidden.
function modelSpan(index) {
  const times = [...index.events.values()].flatMap((event) => [start(event), end(event)]).filter(Number.isFinite);
  return times.length ? { from: minOf(times), to: maxOf(times) } : null;
}
export function hideLaterTimes(label, t, span) {
  if (typeof label !== 'string' || !span) return label;
  return label.replace(/(?<!\d|\d\.)\d+(?:\.\d+)?(?!\d|\.\d)/gu, (number) => {
    const value = Number(number);
    return value > t && value >= span.from && value <= span.to ? '…' : number;
  });
}

// What one person may draw on at t, by allowlist. Event descriptions, interval ends, values recorded after t, other
// holders' accounts and Cuts on Events they share with others are never read.
function characterPacket({ model, index, chat, personId, t, draws }) {
  const person = readPerson(index, personId);
  const span = modelSpan(index);
  const label = (value) => hideLaterTimes(value, t, span);
  const { life } = lifeAt(index, personId, t);
  const own = life ? new Set([life.id, ...eventDescendants(index, life.id)]) : new Set();
  const soleSubject = (event) => {
    const ids = Object.values(event?.participants ?? {}).flat();
    return ids.length > 0 && ids.every((item) => item === personId);
  };
  const past = (event) => start(event) !== null && start(event) <= t && !index.readings.has(event.id);
  const lived = [...new Set([...(index.eventsOf.get(personId) ?? []), ...own])].map((eventId) => index.events.get(eventId))
    .filter((event) => event && past(event) && event.id !== life?.id).sort((a, b) => start(b) - start(a));
  const inner = new Map();
  for (const event of lived) {
    if (!own.has(event.id) && !soleSubject(event)) continue;
    for (const cut of index.cutsByEvent.get(event.id) ?? []) {
      if (cutKind(cut) === 'decision') continue;
      const key = `${cut.question}|${cut.unit}`;
      if (!inner.has(key)) inner.set(key, { question: label(cut.question), kind: cutKind(cut), at: start(event),
        answers: (cut.answers ?? []).slice().sort((a, b) => b.weight - a.weight).slice(0, 4).map(({ key: answer, weight, meaning }) => ({ key: answer, weight, ...(meaning ? { meaning: label(meaning) } : {}) })) });
    }
  }
  const decided = person.cuts.filter(({ cut, event }) => cutKind(cut) === 'decision' && past(event) && (own.has(event.id) || soleSubject(event)) && draws.get(cut.id)?.first)
    .map(({ cut }) => ({ question: label(cut.question), realized: draws.get(cut.id).first.realized }));
  // Their own processes only: declared about them, bound to them, or carried by their own Events. A process carried by
  // an Event they share with others may be someone else's.
  const ownProcesses = new Set((model?.meaning_model?.event_referent_bindings ?? [])
    .filter((binding) => binding.referent_id === personId && binding.target?.kind === 'process').map((binding) => binding.target.process_id));
  for (const process of index.processList) if (process.scale?.subject_referent_id === personId) ownProcesses.add(process.id);
  for (const eventId of own) for (const processId of index.events.get(eventId)?.process_ids ?? []) ownProcesses.add(processId);
  for (const event of lived) if (soleSubject(event)) for (const processId of event.process_ids ?? []) ownProcesses.add(processId);
  const values = processValuesAt(model, index, person, t, 200).values.filter((item) => ownProcesses.has(item.processId));
  // A series held by another modeled person is their belief, not this person's state.
  const heldHere = (holder) => holder === personId || !index.referents.has(holder);
  const value = (item) => {
    const held = (item.recorded ?? []).filter((series) => heldHere(series.holder)).map((series) => series.held)
      .filter((point) => point && point.at <= t).sort((a, b) => b.at - a.at)[0] ?? null;
    const ownAccounts = (item.accounts ?? []).filter((account) => account.holder === personId)
      .map(({ value: stated, at, uncertainty }) => ({ value: stated, at, ...(uncertainty ? { uncertainty } : {}) }));
    return { processId: item.processId, meaning: label(item.meaning), unit: item.unit,
      ...(held ? { held: { at: held.at, ...(held.state !== undefined ? { state: held.state } : { value: held.value }) } } : { initialValue: item.state?.initialValue ?? null }),
      ...(ownAccounts.length ? { ownAccounts } : {}) };
  };
  const voice = values.filter((item) => VOICE.test(`${item.processId} ${item.meaning ?? ''}`)).map(value);
  const knows = chat.knows.filter((item) => item.personId === personId).flatMap((item) => {
    const node = chat.nodes.get(item.factId);
    if (!node || !viewpointAvailability({ viewpointKnownAt: item.at }, node, { worldTime: t, worldTimeEnd: null }).available) return [];
    return [{ factId: item.factId, fact: node.text, since: item.at }];
  });
  const knowsUnique = [...new Map(knows.sort((a, b) => a.since - b.since).map((item) => [item.factId, item])).values()];
  // One entry per name: readings by quarter or by stretch often repeat a label.
  const named = (events) => [...new Map(events.map((event) => [label(event.boundary ?? event.id), event])).entries()];
  const periods = named(person.periods.filter((event) => past(event) && (end(event) ?? Infinity) >= t));
  const inPeriods = new Set(periods.map(([, event]) => event.id));
  const livedNamed = named(lived.filter((event) => !inPeriods.has(event.id)));
  return {
    personId, name: displayName(personId),
    age: life && start(life) !== null ? t - start(life) : null,
    periods: periods.map(([period, event]) => ({ period, since: start(event) })),
    lived: livedNamed.slice(0, 12).map(([what, event]) => ({ eventId: event.id, what, at: start(event) })),
    ...(livedNamed.length > 12 ? { livedOmitted: livedNamed.length - 12 } : {}),
    inner: [...inner.values()].slice(0, 12),
    decided,
    values: values.filter((item) => !VOICE.test(`${item.processId} ${item.meaning ?? ''}`)).slice(0, 12).map(value),
    voice,
    knows: knowsUnique,
  };
}

export async function openStoryChat(service, raw) {
  bounded(raw, 'Story chat opening');
  const input = chatOpenSchema.parse(raw);
  const accessScopes = sortedScopes(input.accessScopes);
  let modelHash = input.modelHash;
  if (input.fromStory) {
    const story = await service.queryNarrativeGraph({ graphHash: input.fromStory.graphHash, expectedGraphHash: input.fromStory.graphHash,
      mode: 'full', includeContent: false, accessScopes });
    if (!story.nodes.some((node) => node.id === input.fromStory.rootId && node.role === 'document_root')) throw new Error('fromStory.rootId is not a document root of that story graph.');
    const storyModel = story.graph?.source?.kind === 'model' ? story.graph.source.model_hash : null;
    if (!storyModel) throw new Error('The story graph is not bound to a model; a chat plays in a model.');
    if (modelHash && modelHash !== storyModel) throw new Error('modelHash differs from the story graph\'s bound model.');
    modelHash = storyModel;
  }
  if (!modelHash) throw new Error('Name the model with modelHash or the story with fromStory.');
  const model = await boundModel(service, modelHash);
  const index = indexModel(model);
  const player = lifeAt(index, input.player.personId, input.startTime);
  if (!player.life) throw new Error(`${player.reason} Build the character's whole life in the model first, so that they belong to the world.`);
  if (!player.alive) throw new Error(player.reason);
  unique(input.facts.map((fact) => fact.id), 'Fact IDs');
  const storyRootId = `${input.chatId}.story`;
  const knowledge = checkKnowledge({ index, facts: input.facts, learned: input.knows, existing: new Map(), until: input.startTime, taken: new Set([input.chatId, storyRootId]) });
  const provenance = [PROVENANCE, `agent:${input.agentId}`, `player:${input.playerId}`];
  const common = { access_scopes: accessScopes, uncertainty: { kind: 'unknown' }, provenance };
  const setup = { schema: SETUP_SCHEMA, chatId: input.chatId, title: input.title, storyRootId, modelHash,
    forkedFrom: input.fromStory, player: { personId: input.player.personId, name: displayName(input.player.personId) },
    playerId: input.playerId, agentId: input.agentId, startTime: input.startTime, book: input.book, knows: input.knows };
  const nodes = [
    { ...common, id: storyRootId, node_type: 'story', role: 'document_root', text: `# ${input.title}`, render: 'include', training: 'exclude',
      epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', authority: { source: input.agentId, weight: 1 } },
    { ...common, id: input.chatId, node_type: 'storytelling.chat', role: 'metadata', text: JSON.stringify(setup), holder: input.agentId,
      subject: input.player.personId, render: 'exclude', training: 'exclude', epistemic_status: 'authored_process', evidence_type: 'creative_hypothesis',
      authority: { source: input.agentId, weight: 1 } },
    ...knowledge.nodes(common, input.agentId),
  ];
  const edges = knowledge.edges(input.chatId, accessScopes, provenance, 0);
  const registered = await service.registerNarrativeGraph({ requestId: input.requestId, narrativeGraph: {
    schema: 'life-sim-rust-narrative-graph/v1', id: `story-chat.${input.chatId}`,
    revision: { number: 0, reason: `Open story chat ${input.chatId}: ${displayName(input.player.personId)} played by ${input.playerId}.`, provenance },
    source: { kind: 'model', model_hash: modelHash }, roots: [storyRootId, input.chatId], nodes, edges } });
  return { schema: 'meaning-model-story-chat-open/v1', graphHash: registered.graphHash, chatId: input.chatId, storyRootId, modelHash,
    forkedFrom: input.fromStory, player: setup.player, book: input.book, graphMutation: true, worldMutation: false,
    nextStep: `Call life_story_chat_prepare with graphHash ${registered.graphHash.slice(0, 12)}…, worldTime ${input.startTime} and who is present, then answer the user in the world.${input.fromStory ? ' The story\'s own graph was only read; this chat writes to its own graph.' : ''}` };
}

// Facts hold from their time on, and nobody learns a fact before it holds or before the moment the record reaches.
function checkKnowledge({ index, facts, learned, existing, until, taken }) {
  for (const fact of facts) {
    if (taken.has(fact.id) || existing.has(fact.id)) throw new Error(`Fact ID ${fact.id} is already used in this chat graph.`);
    if (fact.at > until) throw new Error(`Fact ${fact.id} holds from ${fact.at}, after this record's time ${until}; record it when it happens.`);
    for (const eventId of fact.groundedIn) if (!index.events.has(eventId)) throw new Error(`Fact ${fact.id} names Event ${eventId}, which is not in the chat's model.`);
  }
  const created = new Map(facts.map((fact) => [fact.id, fact.at]));
  for (const item of learned) {
    if (!index.referents.has(item.personId)) throw new Error(`${item.personId} is not a referent in the chat's model.`);
    const node = existing.get(item.factId);
    const holds = created.get(item.factId) ?? (Number.isFinite(node?.evidence_cutoff) ? node.evidence_cutoff : null);
    if (holds === null) throw new Error(`${item.factId} is not a fact in this chat graph (a node with a time it holds from).`);
    if (item.at < holds) throw new Error(`${displayName(item.personId)} cannot know ${item.factId} at ${item.at}; it holds only from ${holds}.`);
    if (item.at > until) throw new Error(`${displayName(item.personId)} learns ${item.factId} at ${item.at}, after this record's time ${until}.`);
  }
  return {
    nodes: (common, holder) => facts.map((fact) => ({ ...common, id: fact.id, node_type: 'authored_fact', role: 'metadata', text: fact.text,
      evidence_cutoff: fact.at, holder, epistemic_status: 'fictional_canon', evidence_type: 'fictional_canon', render: 'exclude', training: 'exclude',
      authority: { source: holder, weight: 1 } })),
    edges: (parentId, accessScopes, provenance, firstOrder) => facts.flatMap((fact, order) => [
      { id: `${fact.id}.placement`, source: endpoint(parentId), target: endpoint(fact.id), family: 'structural', relation: 'contains', order: firstOrder + order, access_scopes: accessScopes, provenance },
      ...fact.groundedIn.map((eventId) => ({ id: `${fact.id}.grounded.${eventId}`, source: endpoint(fact.id), target: anchor(eventId), family: 'grounding', relation: 'grounded_in', access_scopes: accessScopes, provenance })),
    ]),
  };
}

async function readChatGraph(service, graphHash, accessScopes) {
  const view = await service.queryNarrativeGraph({ graphHash, expectedGraphHash: graphHash, mode: 'full', includeContent: true, accessScopes });
  if (view.graph_hash !== graphHash || !view.content_included) throw new Error('Story chat must read the exact chat graph with content.');
  const modelHash = view.graph?.source?.kind === 'model' ? view.graph.source.model_hash : null;
  if (!modelHash) throw new Error('A chat graph is bound to a model.');
  return { view, modelHash };
}

export async function prepareStoryChat(service, raw) {
  bounded(raw, 'Story chat preparation');
  const input = chatPrepareSchema.parse(raw);
  const accessScopes = sortedScopes(input.accessScopes);
  unique(input.present, 'Present people');
  const { view, modelHash } = await readChatGraph(service, input.graphHash, accessScopes);
  const chat = readChat(view, input.chatId);
  const t = input.worldTime;
  if (t < chat.lastTime) throw new Error(`Story chat moves forward: the last turn was at ${chat.lastTime}. A memory or a flashback is told inside a turn, at the turn's time.`);
  const model = await boundModel(service, modelHash);
  const index = indexModel(model);
  const playerId = chat.setup.player.personId;
  const present = input.present.filter((personId) => personId !== playerId);
  const problems = [playerId, ...present].map((personId) => lifeAt(index, personId, t)).filter((item) => !item.alive).map((item) => item.reason);
  if (input.settingEventId && !index.events.has(input.settingEventId)) throw new Error(`Setting ${input.settingEventId} is not an Event in the chat's model.`);
  const draws = chatDraws(view);
  const packet = (personId) => characterPacket({ model, index, chat, personId, t, draws });
  const characters = present.map(packet);
  const player = packet(playerId);
  const people = new Set([playerId, ...present]);
  const lives = new Set([...people].flatMap((personId) => {
    const life = index.referents.get(personId)?.lifecycle_event_id;
    return life ? [...eventDescendants(index, life)] : [];
  }));
  const involves = (event) => lives.has(event.id) || Object.values(event.participants ?? {}).flat().some((item) => people.has(item));
  const ahead = [...index.events.values()].filter((event) => start(event) !== null && start(event) > t && start(event) <= t + input.horizon
    && !index.readings.has(event.id) && involves(event)).sort((a, b) => start(a) - start(b));
  const realizedInModel = new Map(index.relations.filter((relation) => relation.kind === 'realizes_forecast' && relation.forecast_answer?.cut_id)
    .map((relation) => [relation.forecast_answer.cut_id, relation.forecast_answer.answer_key]));
  const choiceCuts = index.cuts.filter((cut) => cutKind(cut) === 'decision').map((cut) => ({ cut, event: index.events.get(cut.parent_event_id) }))
    .filter(({ event }) => event && start(event) !== null && start(event) >= t && start(event) <= t + input.horizon && involves(event));
  const settingEvent = input.settingEventId ? index.events.get(input.settingEventId) : null;
  const questions = [];
  // The user voices their own character; the others are yours to voice.
  for (const character of characters) {
    if (!character.voice.length) questions.push({ kind: 'voice-unmodeled', subject: character.personId,
      question: `No process follows how ${character.name} speaks. Model their speech as a process (its course, how it varies with the situation) before giving them much to say.` });
    if (!character.inner.length) questions.push({ kind: 'inner-unmodeled', subject: character.personId,
      question: `The model holds nothing about what ${character.name} wants or feels by ${t}. Model it before playing them in a consequential exchange.` });
  }
  const quiet = chat.turns.slice().reverse().findIndex((turn) => turn.events.length > 0);
  const turnsWithoutEvents = quiet === -1 ? chat.turns.length : quiet;
  if (turnsWithoutEvents >= 3) questions.push({ kind: 'play-unmodeled', subject: input.chatId,
    question: `${turnsWithoutEvents} turns have passed without an Event in the model. Did anything happen that a later chat should find? Put it in the model, or go on if nothing did.` });
  for (const [cutId, entry] of draws) if (entry.rerolls.length) questions.push({ kind: 'reroll-present', subject: cutId,
    question: `This chat graph holds a reroll over ${cutId} (${entry.rerolls.join(', ')}). The chat plays only the first draw (${entry.first?.realized ?? 'none'}).` });
  const recent = chat.turns.slice(-input.recent).map((turn) => ({ turn: turn.turn, worldTime: turn.worldTime,
    player: chat.messages.get(turn.playerMessageId)?.text ?? null, reply: chat.messages.get(turn.replyMessageId)?.text ?? null }));
  return {
    schema: 'meaning-model-story-chat-turn-packet/v1',
    chat: { chatId: input.chatId, title: chat.setup.title, storyRootId: chat.setup.storyRootId, modelHash, forkedFrom: chat.setup.forkedFrom,
      book: chat.book, turns: chat.turns.length, lastTime: chat.lastTime },
    worldTime: t,
    userCharacter: { personId: playerId, name: player.name, age: player.age, periods: player.periods, knows: player.knows,
      rule: 'The user speaks and acts for this character. Never write their words, choices or feelings. The others know of them only what they have seen or been told.' },
    characters,
    world: {
      audience: 'narrator only: no character may use it',
      setting: settingEvent ? { eventId: settingEvent.id, what: settingEvent.boundary ?? settingEvent.id, description: settingEvent.description ?? null,
        from: start(settingEvent), to: end(settingEvent) } : null,
      course: ahead.slice(0, 20).map((event) => ({ eventId: event.id, what: event.boundary ?? event.id, description: event.description ?? null, at: start(event),
        people: [...new Set(Object.values(event.participants ?? {}).flat())].map(displayName) })),
      courseSource: chat.setup.forkedFrom ? 'what the book had after this point; the play may change it' : 'what the model holds after this point; the play may change it',
      openChoices: choiceCuts.filter(({ cut }) => !draws.get(cut.id)?.first).map(({ cut, event }) => ({ cutId: cut.id, question: cut.question, at: start(event),
        answers: (cut.answers ?? []).map(({ key, weight, meaning }) => ({ key, weight, ...(meaning ? { meaning } : {}) })),
        ...(realizedInModel.has(cut.id) ? { modelRealized: realizedInModel.get(cut.id) } : {}) })),
      decided: [...draws].filter(([, entry]) => entry.first).map(([cutId, entry]) => ({ cutId, question: entry.first.question, realized: entry.first.realized, drawNodeId: entry.first.nodeId })),
    },
    recent,
    problems,
    questions,
    guidance: 'Answer as the world and the characters present. Give each character only what their packet holds: their state now and what they know by now. Names and boundaries are the modeler\'s labels and can mention later times, as a period called "the ward years, 2000-2010" does; a character knows only what they could know now. Draw an open choice when the exchange reaches it, and play the drawn answer. Then record the turn with life_story_chat_record.',
  };
}

export async function recordStoryChat(service, raw) {
  bounded(raw, 'Story chat record');
  const parsed = chatRecordSchema.parse(raw);
  const head = await resolveAppendHead(service, parsed.graphHash, parsed.requestId);
  const input = { ...parsed, graphHash: head.graphHash };
  const accessScopes = sortedScopes(input.accessScopes);
  unique(input.present, 'Present people'); unique(input.events, 'Events'); unique(input.draws, 'Draws');
  unique(input.facts.map((fact) => fact.id), 'Fact IDs');
  const { view, modelHash } = await readChatGraph(service, input.graphHash, accessScopes);
  const chat = readChat(view, input.chatId);
  const t = input.worldTime, until = input.worldTimeEnd ?? input.worldTime;
  if (until < t) throw new Error('worldTimeEnd must not precede worldTime.');
  if (t < chat.lastTime) throw new Error(`Story chat moves forward: the last turn was at ${chat.lastTime}.`);
  const model = await boundModel(service, modelHash);
  const index = indexModel(model);
  for (const personId of [chat.setup.player.personId, ...input.present]) {
    const life = lifeAt(index, personId, t);
    if (!life.alive) throw new Error(`${life.reason} If they are there, revise the model first.`);
  }
  if (input.settingEventId && !index.events.has(input.settingEventId)) throw new Error(`Setting ${input.settingEventId} is not an Event in the chat's model.`);
  for (const eventId of input.events) if (!index.events.has(eventId)) {
    throw new Error(`Event ${eventId} is not in the chat graph's model ${modelHash.slice(0, 12)}. Add it with life_model_revise and bind the chat graph to that model with life_narrative_rebind first.`);
  }
  const draws = chatDraws(view);
  for (const nodeId of input.draws) {
    const node = chat.nodes.get(nodeId);
    const draw = node?.node_type === 'direction_draw' ? parse(node.text) : null;
    if (!draw) throw new Error(`${nodeId} is not a direction_draw record in this chat graph. Record the draw with life_direction_draw on this graph.`);
    if (draw.reroll || draws.get(draw.cutId)?.first?.nodeId !== nodeId) {
      throw new Error(`${nodeId} rerolls "${draw.question}", drawn first as ${draws.get(draw.cutId)?.first?.realized ?? 'unknown'} (${draws.get(draw.cutId)?.first?.nodeId ?? '?'}). A drawn outcome stays drawn; play that answer.`);
    }
  }
  const n = chat.turns.length + 1;
  const turnId = `${input.chatId}.turn.${n}`;
  const playerMessageId = `${turnId}.player`, replyMessageId = `${turnId}.reply`;
  const taken = new Set([turnId, playerMessageId, replyMessageId]);
  for (const nodeId of taken) if (chat.nodes.has(nodeId)) throw new Error(`${nodeId} already exists in this chat graph.`);
  const knowledge = checkKnowledge({ index, facts: input.facts, learned: input.learned, existing: chat.nodes, until, taken });
  const { agentId, playerId } = chat.setup;
  const provenance = [PROVENANCE, `agent:${agentId}`, `player:${playerId}`];
  const common = { access_scopes: accessScopes, uncertainty: { kind: 'unknown' }, provenance };
  const effectiveBook = input.book ?? chat.book;
  const turn = { schema: TURN_SCHEMA, chatId: input.chatId, turn: n, worldTime: t, worldTimeEnd: input.worldTimeEnd,
    present: input.present, settingEventId: input.settingEventId, events: input.events, draws: input.draws,
    facts: input.facts.map((fact) => fact.id), learned: input.learned, book: input.book, playerMessageId, replyMessageId };
  const message = (nodeId, speaker, holder, value, as) => ({ ...common, id: nodeId, node_type: 'storytelling.chat_message', role: 'metadata',
    text: JSON.stringify({ schema: MESSAGE_SCHEMA, chatId: input.chatId, turn: n, speaker, ...(as ? { as } : {}), text: value }),
    holder, subject: input.chatId, value_time: t, render: 'exclude', training: 'exclude',
    epistemic_status: 'supplied_source_message', evidence_type: 'report', authority: { source: holder, weight: 1 } });
  const nodes = [
    { ...common, id: turnId, node_type: 'storytelling.chat_turn', role: 'metadata', text: JSON.stringify(turn), holder: agentId, subject: input.chatId,
      value_time: t, render: 'exclude', training: 'exclude', epistemic_status: 'authored_process', evidence_type: 'creative_hypothesis', authority: { source: agentId, weight: 1 } },
    message(playerMessageId, 'user', playerId, input.player.text, chat.setup.player.personId),
    message(replyMessageId, 'agent', agentId, input.reply.text, null),
    ...knowledge.nodes(common, agentId),
  ];
  const edge = (suffix, source, target, family, relation, extra = {}) => ({ id: `${turnId}.${suffix}`, source, target, family, relation, access_scopes: accessScopes, provenance, ...extra });
  const learnedElsewhere = [...new Set(input.learned.map((item) => item.factId).filter((factId) => chat.nodes.has(factId)))];
  const edges = [
    edge('placement', endpoint(input.chatId), endpoint(turnId), 'structural', 'contains', { order: n }),
    edge('player', endpoint(turnId), endpoint(playerMessageId), 'structural', 'contains', { order: 0 }),
    edge('reply', endpoint(turnId), endpoint(replyMessageId), 'structural', 'contains', { order: 1 }),
    ...knowledge.edges(turnId, accessScopes, provenance, 2),
    ...input.events.map((eventId) => edge(`event.${eventId}`, endpoint(turnId), anchor(eventId), 'grounding', 'about')),
    ...(input.settingEventId && !input.events.includes(input.settingEventId) ? [edge('setting', endpoint(turnId), anchor(input.settingEventId), 'grounding', 'located_in')] : []),
    ...input.draws.map((nodeId) => edge(`draw.${nodeId}`, endpoint(turnId), endpoint(nodeId), 'semantic', 'shaped_by')),
    ...learnedElsewhere.map((factId) => edge(`learned.${factId}`, endpoint(turnId), endpoint(factId), 'semantic', 'about')),
  ];
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: {
    schema: 'life-sim-rust-narrative-batch/v1', previous_graph_hash: input.graphHash,
    reason: `Record story chat turn ${n} of ${input.chatId}.`, provenance, add_roots: [], add_nodes: nodes, add_edges: edges } });
  return { schema: 'meaning-model-story-chat-record/v1', graphHash: stored.graphHash, previousGraphHash: input.graphHash,
    ...(head.advancedFrom ? { advancedFrom: head.advancedFrom } : {}), chatId: input.chatId, turn: n, turnNodeId: turnId,
    playerMessageId, replyMessageId, book: effectiveBook, graphMutation: true, worldMutation: false,
    nextStep: effectiveBook === 'book'
      ? `Go on with the next turn. When a stretch of play is worth a chapter, write it through life_story_scene_prepare on this graph's story root (${chat.setup.storyRootId}), with ${chat.setup.player.name} as one viewpoint and the chat's knowledge declarations as scene.context.`
      : 'Go on with the next turn. The user chose chat only, so no book is written unless they change that.' };
}

// The cast a user may choose from, for the start prompt.
export async function storyChatCast(service, modelHash) {
  const model = await boundModel(service, modelHash);
  return modeledPeople(indexModel(model)).slice(0, 24);
}
