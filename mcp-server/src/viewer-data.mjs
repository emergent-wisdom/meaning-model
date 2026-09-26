// Turn complete model/graph definitions into a browser snapshot. Acquisition and access checks belong to the caller.
// Adapted from the Meaning Model Viewer's extract.mjs; see ../viewer/README.md.
import { indexModel, modeledPeople, readPerson, cutKind, eventDescendants } from './model-questions.mjs';
import { readLenses } from './lenses.mjs';
import { readPath } from '../viewer/measures.mjs';
import { placeStoryUnits, countProseWords } from '../viewer/public/story-time.js';
import { projectDocument } from './document-projection.mjs';

export async function buildViewerData({ history, rendered = null, calls = [], name = null, title: requestedTitle = null,
  display = null, meaningModelVersion = null, generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(history?.models) || !history.models.length || !Array.isArray(history.revisions)
    || history.models.some((entry) => !entry?.definition || typeof entry.definition !== 'object')) {
    throw new Error('A viewer snapshot needs at least one complete model definition and a graph revisions array.');
  }
  const HASH = /\b[0-9a-f]{64}\b/g;
  // When each hash first appeared in a logged result: the call that made it.
  const hashAt = new Map();
  for (const entry of calls) {
    if (entry.result?.isError) continue;
    for (const hash of JSON.stringify(entry.result ?? {}).match(HASH) ?? []) if (!hashAt.has(hash)) hashAt.set(hash, { at: entry.at, seq: entry.seq, tool: entry.command.name });
  }
  const firstCall = calls[0]?.at ?? null;

  // ---- time ----------------------------------------------------------------------------------------------------------
  const finalModelEntry = history.models.at(-1);


  // ---- model births ---------------------------------------------------------------------------------------------------
  const born = new Map(); // record key -> { rev, at }
  const modelSteps = [];
  let previous = { events: new Set(), cuts: new Set(), referents: new Set(), relations: new Set(), processes: new Set() };
  history.models.forEach((entry, rev) => {
    const mm = entry.definition.meaning_model ?? {};
    const now = {
      events: new Set((mm.events ?? []).map((item) => item.id)), cuts: new Set((mm.normalized_cuts ?? []).map((item) => item.id)),
      referents: new Set((mm.referents ?? []).map((item) => item.id)), processes: new Set((entry.definition.processes ?? []).map((item) => item.id)),
      relations: new Set((mm.event_relations ?? []).map((item) => item.id ?? `${item.source_event_id}>${item.kind}>${item.target_event_id}`)),
    };
    const at = hashAt.get(entry.modelHash)?.at ?? null;
    const added = {};
    for (const [collection, ids] of Object.entries(now)) {
      added[collection] = [...ids].filter((id) => !previous[collection].has(id));
      for (const id of added[collection]) if (!born.has(`${collection}:${id}`)) born.set(`${collection}:${id}`, { rev, at });
    }
    modelSteps.push({ rev, modelHash: entry.modelHash, at, reason: String(entry.definition.revision?.reason ?? '').slice(0, 280),
      added: Object.fromEntries(Object.entries(added).map(([key, ids]) => [key, ids.length])),
      totals: Object.fromEntries(Object.entries(now).map(([key, ids]) => [key, ids.size])) });
    previous = now;
  });

  // ---- graph replay ------------------------------------------------------------------------------------------------------
  const nodes = new Map(); const edges = new Map(); const graphSteps = [];
  const nodeBorn = new Map(); const edgeBorn = new Map();
  let boundModel = null;
  history.revisions.forEach((revision, rev) => {
    const at = hashAt.get(revision.graphHash)?.at ?? null;
    const added = [];
    if (revision.definition) {
      for (const node of revision.definition.nodes ?? []) { nodes.set(node.id, node); added.push(node.id); }
      for (const edge of revision.definition.edges ?? []) edges.set(edge.id, edge);
      boundModel = revision.definition.source?.model_hash ?? boundModel;
    } else {
      const delta = revision.delta;
      for (const id of delta.removeNodeIds ?? []) nodes.delete(id);
      for (const id of delta.removeEdgeIds ?? []) edges.delete(id);
      for (const node of delta.upsertNodes ?? []) { if (!nodes.has(node.id)) added.push(node.id); nodes.set(node.id, node); }
      for (const edge of delta.upsertEdges ?? []) edges.set(edge.id, edge);
      if (delta.source?.model_hash) boundModel = delta.source.model_hash;
    }
    for (const id of added) if (!nodeBorn.has(id)) nodeBorn.set(id, { rev, at });
    for (const id of edges.keys()) if (!edgeBorn.has(id)) edgeBorn.set(id, { rev, at });
    const reason = revision.definition?.revision?.reason ?? revision.delta?.revision?.reason ?? '';
    graphSteps.push({ rev, graphHash: revision.graphHash, at, reason: String(reason).slice(0, 280), added: added.length, boundModel });
  });

  // The model the story graph is bound to at its head, else the newest one.
  const selectedModelEntry = boundModel ? history.models.find((entry) => entry.modelHash === boundModel) : finalModelEntry;
  if (!selectedModelEntry) throw new Error('The viewer history is missing the graph-bound model definition.');
  const model = selectedModelEntry.definition;
  const runName = name ?? history.graphId ?? model.id ?? 'model';
  const unit = String(model.time_unit ?? '');
  const calendarTime = unit === 'year' || unit === 'years' || unit.startsWith('civil_day_since_1970');
  const pathOf = (support) => calendarTime ? readPath(support) : [];
  // Calendar scenes use decimal years. Other clocks retain their values and are shown in the inspector.
  const toYear = (t) => (t === null || t === undefined ? null : unit.startsWith('civil_day_since_1970') ? 1970 + t / 365.2425 : unit.startsWith('year') ? t : t);
  const index = indexModel(model);
  const mm = model.meaning_model ?? {};
  const birthOf = (collection, id) => born.get(`${collection}:${id}`) ?? null;
  const start = (event) => event?.interval?.start ?? null;
  const end = (event) => event?.interval?.end ?? null;
  const clip = (text, length) => { const value = String(text ?? '').replace(/\s+/g, ' ').trim(); return value.length > length ? `${value.slice(0, length - 1)}…` : value; };
  const parentOf = (id) => [...(index.parents.get(id) ?? [])][0] ?? null;

  // ---- contexts: whose record each Event is ----------------------------------------------------------------------------------
  // Every Event is governed by the nearest declared context root above it, found through containment and never from a
  // field of its own: the accepted world, a person's inner process, or a holder's understanding (and any other kind a
  // model declares). A model that declares no roots holds everything as world. A reading is an Event under an
  // understanding root, or one the lens placement made beneath its holder; it is about the record it reads (an about
  // relation) and never a part of the world. Models before placement (Meaning Model 0.3.0) keep lens readings on the
  // records they read.
  const rootKinds = new Map((mm.context_roots ?? []).map((root) => [root.event_id, root.kind]));
  const contextOf = (id) => {
    for (let at = id, hops = 0; at && hops < 256; at = parentOf(at), hops += 1) if (rootKinds.has(at)) return { kind: rootKinds.get(at), root: at };
    return { kind: rootKinds.size ? 'unrooted' : 'accepted_world', root: null };
  };
  const isAboutRelation = (relation) => relation.kind === 'about' || (relation.kind === 'other' && /^about\b/i.test(String(relation.description ?? '')));
  const aboutOf = new Map();
  for (const relation of mm.event_relations ?? []) if (isAboutRelation(relation)) { if (!aboutOf.has(relation.source_event_id)) aboutOf.set(relation.source_event_id, []); aboutOf.get(relation.source_event_id).push(relation.target_event_id); }
  // Whose a root is: a person's inner root is theirs; an understanding root names its holder.
  const rootHolder = (rootId) => {
    if (!rootId) return null; const kind = rootKinds.get(rootId); const event = index.events.get(rootId);
    if (kind === 'inner') return [event?.participants?.subject].flat()[0] ?? null;
    if (kind === 'understanding') return String(event?.boundary ?? '').match(/^What (.+?) understands\b/)?.[1] ?? rootId.replace(/^understanding\./, '');
    return null;
  };
  const placedByLens = (event) => (event?.provenance ?? []).some((item) => /lens placement/i.test(String(item)));
  const readingEvents = new Map();
  for (const event of mm.events ?? []) {
    const context = contextOf(event.id);
    const isReading = (context.kind === 'understanding' && !rootKinds.has(event.id)) || (placedByLens(event) && /^(reading|inner)\./.test(event.id) && !rootKinds.has(event.id));
    if (!isReading) continue;
    const perspective = context.kind === 'inner' ? (event.id.startsWith('inner.') ? 'actor' : 'reader') : 'modeler';
    readingEvents.set(event.id, { id: event.id, about: aboutOf.get(event.id) ?? [], context: context.kind, root: context.root, holder: rootHolder(context.root), perspective });
  }

  // ---- people --------------------------------------------------------------------------------------------------------------
  const nameOf = (referent) => {
    const boundary = String(referent?.boundary ?? '');
    const lead = boundary.split(/[,;(]| - | — /)[0].trim();
    if (lead && lead.split(/\s+/).length <= 4 && /^[A-ZÅÄÖÉ]/u.test(lead)) return lead.replace(/^(the|a) /i, '');
    const tail = String(referent?.id ?? '').split(/\.person\.|\./).filter(Boolean).at(-1) ?? '';
    return tail.replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  };
  const draws = [...nodes.values()].filter((node) => node.node_type === 'direction_draw').map((node) => {
    try { const data = JSON.parse(node.text); const draw = data?.data ?? data; return { nodeId: node.id, cutId: draw.cutId, realized: draw.realized, remainder: Boolean(draw.realizedIsRemainder), seed: draw.seed ?? null, u: draw.u ?? null }; } catch { return null; }
  }).filter(Boolean);
  const drawOf = new Map(draws.map((draw) => [draw.cutId, draw]));
  const allCuts = mm.normalized_cuts ?? [];
  const withdrawn = new Set(allCuts.filter((cut) => cut.withdrawn).map((cut) => cut.id));

  const listed = modeledPeople(index);
  const people = listed.map((person, order) => {
    const read = readPerson(index, person.id);
    const series = new Map();
    for (const item of read.cuts) {
      const kind = cutKind(item.cut);
      if (kind === 'decision' || start(item.event) === null || String(item.cut.id).startsWith('lens.') || readingEvents.has(item.event.id)) continue;
      const key = `${kind}|${String(item.cut.question ?? '').toLowerCase().trim()}|${item.cut.unit ?? ''}`;
      if (!series.has(key)) series.set(key, { kind, question: String(item.cut.question ?? item.cut.id), unit: item.cut.unit ?? '', points: [] });
      series.get(key).points.push({ t: toYear(start(item.event)), end: toYear(end(item.event)), eventId: item.event.id, cutId: item.cut.id,
        answers: (item.cut.answers ?? []).slice().sort((a, b) => b.weight - a.weight).map((answer) => ({ key: answer.key, weight: +answer.weight.toFixed(4) })),
        born: birthOf('cuts', item.cut.id) });
    }
    const decisions = read.cuts.filter((item) => cutKind(item.cut) === 'decision').map((item) => ({
      cutId: item.cut.id, question: clip(item.cut.question, 220), t: toYear(start(item.event)), eventId: item.event.id,
      answers: (item.cut.answers ?? []).slice().sort((a, b) => b.weight - a.weight).map((answer) => ({ key: answer.key, weight: +answer.weight.toFixed(4) })),
      drawn: drawOf.get(item.cut.id) ?? null, born: birthOf('cuts', item.cut.id) }));
    const lifeStart = toYear(start(read.life)); const lifeEnd = toYear(end(read.life));
    return {
      id: person.id, name: nameOf(read.referent), principal: person.principal, order,
      who: clip(read.referent?.boundary, 320), born: birthOf('referents', person.id),
      life: read.life ? { eventId: read.life.id, start: lifeStart, end: lifeEnd, born: birthOf('events', read.life.id) } : null,
      processes: read.processes.map((item) => ({ eventId: item.eventId, what: clip(item.what, 120), opened: item.opened })),
      periods: read.periods.map((event) => ({ eventId: event.id, what: clip(event.description ?? event.boundary, 160), start: toYear(start(event)), end: toYear(end(event)), born: birthOf('events', event.id) })),
      arcs: read.arcs.map((item) => ({ eventId: item.arcEventId, what: clip(item.arc?.description ?? item.arc?.boundary ?? item.arcEventId, 180),
        start: toYear(start(item.arc)), end: toYear(end(item.arc)), focal: toYear(start(item.focal ?? item.arc)), focalEnd: toYear(end(item.focal ?? item.arc)),
        adaptationEnd: toYear(end(item.adaptation ?? item.arc)), born: birthOf('events', item.arcEventId) })),
      series: [...series.values()].map((entry) => ({ ...entry, points: entry.points.sort((a, b) => a.t - b.t) })).sort((a, b) => b.points.length - a.points.length),
      decisions: decisions.filter((item) => !withdrawn.has(item.cutId)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0)),
    };
  });

  // ---- events ---------------------------------------------------------------------------------------------------------------
  const lifeEvents = new Set(people.map((person) => person.life?.eventId).filter(Boolean));
  const periodEvents = new Set(people.flatMap((person) => person.periods.map((period) => period.eventId)));
  const arcEvents = new Set([...index.arcsOf.values()].flat().flatMap((id) => [id, ...eventDescendants(index, id)]));
  const events = (mm.events ?? []).map((event) => {
    const span = start(event) !== null && end(event) !== null ? end(event) - start(event) : null;
    const participants = [...new Set(Object.values(event.participants ?? {}).flat().map(String))];
    const kind = lifeEvents.has(event.id) ? 'life' : periodEvents.has(event.id) ? 'period' : arcEvents.has(event.id) ? 'arc'
      : (index.cutsByEvent.get(event.id) ?? []).some((cut) => cutKind(cut) === 'decision') ? 'decision' : 'event';
    return { id: event.id, label: clip(event.boundary ?? event.id, 90), description: clip(event.description, 360), start: toYear(start(event)), end: toYear(end(event)),
      span: span === null ? null : toYear(end(event)) - toYear(start(event)), parent: parentOf(event.id), region: event.region ?? null, participants, kind,
      cuts: (index.cutsByEvent.get(event.id) ?? []).length, processIds: event.process_ids ?? [], born: birthOf('events', event.id),
      context: contextOf(event.id).kind, ...(rootKinds.has(event.id) ? { root: rootKinds.get(event.id) } : {}),
      ...(readingEvents.has(event.id) ? { reading: { about: readingEvents.get(event.id).about, holder: readingEvents.get(event.id).holder, perspective: readingEvents.get(event.id).perspective } } : {}) };
  });
  // Causal and other links between Events; containment is the tree, and about is a reading's reference to its record.
  const relations = (mm.event_relations ?? []).filter((relation) => relation.kind !== 'contains' && !isAboutRelation(relation)).map((relation) => ({
    source: relation.source_event_id, target: relation.target_event_id, kind: relation.kind,
    ...(relation.description ? { description: relation.description } : {}), ...(relation.forecast_answer ? { forecast: relation.forecast_answer } : {}),
    born: birthOf('relations', relation.id ?? `${relation.source_event_id}>${relation.kind}>${relation.target_event_id}`) }));

  // ---- the mind: graph nodes ------------------------------------------------------------------------------------------------------
  const category = (node) => {
    const type = String(node.node_type ?? '');
    if (type.startsWith('understanding.')) return 'thought';
    if (type === 'storytelling.world') return 'world';
    if (type === 'storytelling.direction') return 'director';
    if (type === 'direction_draw') return 'draw';
    if (node.role === 'story_passage' || /passage|scene|chapter/.test(type)) return 'passage';
    if (type === 'model_reference') return 'reference';
    if (/root|document|story$/.test(type) || node.role === 'document_root') return 'root';
    if (type.startsWith('storytelling.') || type.startsWith('story.')) return 'author';
    if (/review|assessment|depth/.test(type)) return 'review';
    return 'other';
  };
  const textOf = (node) => {
    const raw = String(node.text ?? '');
    try {
      const payload = JSON.parse(raw); const data = payload?.data ?? payload;
      if (data?.stage) return clip(`${data.stage}: ${node.title ?? ''} ${payload.text ?? data.summary ?? ''}`, 900);
      return clip(payload?.text ?? data?.text ?? data?.summary ?? data?.question ?? node.title ?? raw, 900);
    } catch { return clip(raw, 1400); }
  };
  const graphNodes = [...nodes.values()].map((node) => ({
    id: node.id, type: node.node_type, category: category(node), role: node.role ?? null, title: clip(node.title ?? '', 140), text: textOf(node),
    holder: node.holder ?? null, words: category(node) === 'passage' ? countProseWords(node.text) : 0,
    born: nodeBorn.get(node.id) ?? null, valueTime: node.value_time ?? null }));
  const keep = new Set(graphNodes.map((node) => node.id));
  const eventIds = new Set(events.map((event) => event.id));
  const personIds = new Set(people.map((person) => person.id));
  const cutEvent = new Map((mm.normalized_cuts ?? []).map((cut) => [cut.id, cut.parent_event_id ?? null]));
  const graphEdges = [...edges.values()].map((edge) => {
    const source = edge.source?.kind === 'node' ? edge.source.node_id : null;
    const target = edge.target?.kind === 'node' ? { node: edge.target.node_id } : edge.target?.kind === 'anchor' ? { anchor: edge.target.anchor_id, anchorKind: edge.target.anchor_kind,
      event: edge.target.anchor_kind === 'event' ? edge.target.anchor_id : edge.target.anchor_kind === 'normalized_cut' ? cutEvent.get(edge.target.anchor_id) ?? null : null } : null;
    return { id: edge.id, source, target, relation: edge.relation ?? edge.family ?? null, born: edgeBorn.get(edge.id) ?? null };
  }).filter((edge) => edge.source && keep.has(edge.source) && edge.target && ((edge.target.node && keep.has(edge.target.node)) || edge.target.anchor));

  // ---- construction timeline -------------------------------------------------------------------------------------------------------
  const steps = [
    ...modelSteps.map((step) => ({ kind: 'model', at: step.at, rev: step.rev, label: step.reason, added: step.added, totals: step.totals })),
    ...graphSteps.map((step) => ({ kind: 'graph', at: step.at, rev: step.rev, label: step.reason, added: step.added })),
  ].filter((step) => step.at).sort((a, b) => a.at.localeCompare(b.at));
  const toolCalls = calls.map((entry) => ({ at: entry.at, tool: entry.command.name, error: Boolean(entry.result?.isError) }));

  // ---- story window and deep time -----------------------------------------------------------------------------------------------------
  const lives = people.filter((person) => person.principal && person.life);
  const storyTimes = events.filter((event) => event.kind === 'decision' || (event.span !== null && event.span < 1.5)).map((event) => event.start).filter((t) => t !== null).sort((a, b) => a - b);
  // The story's present: from the route's first part's moment to its last one's (each part's shortest Event), else the
  // span of its short, decision-bearing Events.
  let window = null;
  const routeNode = [...nodes.values()].filter((node) => node.node_type === 'storytelling.world' && /"stage":"route"/.test(String(node.text))).at(-1);
  if (routeNode) {
    try {
      const route = JSON.parse(routeNode.text).data; const byId = new Map(events.map((event) => [event.id, event]));
      const moments = route.parts.map((part) => part.eventIds.map((id) => byId.get(id)).filter((event) => event && event.start !== null && !arcEvents.has(event.id))
        .sort((a, b) => ((a.end ?? a.start) - a.start) - ((b.end ?? b.start) - b.start))[0]).filter(Boolean);
      if (moments.length) window = { start: Math.min(...moments.map((event) => event.start)), end: Math.max(...moments.map((event) => event.end ?? event.start)) };
    } catch { window = null; }
  }
  // The author's route: the story's parts in reading order, each with the Events it tells, as the author planned them.
  let storyRoute = null;
  if (routeNode) { try { const route = JSON.parse(routeNode.text).data; storyRoute = (route.parts ?? []).map((part, i) => ({ n: i + 1, ...Object.fromEntries(Object.entries(part).filter(([key, value]) => key !== 'eventIds' && (typeof value === 'string' || typeof value === 'number'))), eventIds: (part.eventIds ?? []).filter((id) => events.some((event) => event.id === id)) })); } catch { storyRoute = null; } }
  if (!window && storyTimes.length >= 2) window = { start: storyTimes[Math.floor(storyTimes.length * 0.05)], end: storyTimes[Math.ceil(storyTimes.length * 0.95) - 1] };
  const allStarts = events.map((event) => event.start).filter((t) => t !== null);
  const extent = allStarts.length ? { start: Math.min(...allStarts), end: Math.max(...events.map((event) => event.end ?? event.start).filter((t) => t !== null)) } : null;

  const titled = [...nodes.values()].find((node) => node.node_type === 'storytelling.world' && /candidates/.test(String(node.text)));
  let title = requestedTitle;
  if (!title && titled) { try { const data = JSON.parse(titled.text).data; title = data.candidates.find((item) => item.id === data.selection.chosenId)?.title ?? null; } catch { title = null; } }

  // ---- measures: the model's named processes, each with the value path its support states ---------------------------------
  const measures = (model.processes ?? []).filter((process) => !String(process.id).startsWith('profile.')).map((process) => {
    const support = (process.support ?? []).join(' ; ');
    return { id: process.id, unit: process.unit ?? null, frame: process.reference_frame ?? null, role: clip(process.scale?.semantic_role, 240) || null,
      support: clip(support, 600), points: pathOf(support).map((point) => ({ ...point, t: +point.t.toFixed(4) })),
      events: events.filter((event) => event.processIds.includes(process.id)).map((event) => event.id), born: birthOf('processes', process.id) };
  });

  // ---- the explorer: the whole Event tree, every process in it, and the lenses' readings -------------------------------------
  // Each Event's depth in the containment tree, its role there and whose it is. An Event without an interval (the world, an
  // inner root, a slow process) spans what it holds, else what holds it, so every Event has a place in time.
  const referents = (mm.referents ?? []).map((referent) => ({ id: referent.id, name: nameOf(referent), life: referent.lifecycle_event_id ?? null,
    person: listed.some((person) => person.id === referent.id), who: clip(referent.boundary, 240) }));
  const lifeOf = new Map(referents.filter((referent) => referent.life).map((referent) => [referent.life, referent.id]));
  const innerRoots = new Map((mm.context_roots ?? []).filter((root) => root.kind === 'inner').map((root) => [root.event_id, [index.events.get(root.event_id)?.participants?.subject ?? null].flat()[0]]));
  const depthOf = new Map();
  { const queue = (mm.events ?? []).filter((event) => !index.parents.has(event.id)).map((event) => [event.id, 0]);
    while (queue.length) { const [id, depth] = queue.shift(); if (depthOf.has(id)) continue; depthOf.set(id, depth); for (const child of index.children.get(id) ?? []) queue.push([child, depth + 1]); } }
  const treeRoots = (mm.events ?? []).filter((event) => !index.parents.has(event.id)).map((event) => event.id);
  const arcIds = new Set([...index.arcsOf.values()].flat());
  const phaseOf = (id) => { const match = id.match(/^(.*)\.(anticipation|focal_change|adaptation)$/); return match && arcIds.has(match[1]) ? match[2] : null; };
  const ownerOf = (id) => { for (let at = id, hops = 0; at && hops < 64; at = parentOf(at), hops += 1) { if (lifeOf.has(at)) return lifeOf.get(at); if (innerRoots.has(at)) return innerRoots.get(at); } return null; };
  const reach = new Map();
  const reachOf = (id) => {
    if (reach.has(id)) return reach.get(id); reach.set(id, null);
    const event = index.events.get(id); let span = start(event) !== null ? [toYear(start(event)), toYear(end(event) ?? start(event))] : null;
    if (!span) { const inside = (index.children.get(id) ?? []).map(reachOf).filter(Boolean); if (inside.length) span = [Math.min(...inside.map((s) => s[0])), Math.max(...inside.map((s) => s[1]))]; }
    reach.set(id, span); return span;
  };
  for (const event of events) {
    const depth = depthOf.get(event.id) ?? 0; const span = event.span;
    event.depth = depth; event.owner = ownerOf(event.id);
    // Readings, and any context that is not the world or a person's inner process (a holder's understanding, a document, a
    // candidate), are not parts of the world's tree.
    const foreign = !['accepted_world', 'inner', 'unrooted'].includes(event.context);
    event.role = readingEvents.has(event.id) ? 'reading' : foreign ? event.root ?? event.context
      : depth === 0 ? 'world' : lifeOf.has(event.id) ? 'life' : innerRoots.has(event.id) ? 'inner' : /\.is\.[a-z]+$/.test(event.id) ? 'slow' : arcIds.has(event.id) ? 'arc'
      : phaseOf(event.id) ? 'phase' : periodEvents.has(event.id) ? 'period' : depth === 1 ? 'development' : span !== null && span > 1 ? 'part' : 'moment';
    if (event.role === 'phase') event.phase = phaseOf(event.id);
    let span2 = reachOf(event.id);
    for (let at = event.parent; !span2 && at; at = parentOf(at)) span2 = reachOf(at);
    event.reach = span2 ?? (extent ? [extent.start, extent.end] : null);
  }

  // Every process with its place in the tree. A scaffold process (a life, its slow processes, a change arc and its phases)
  // lives on the Event the scaffold made for it; a named process sits under the life or thing it is about (its frame or
  // its id), else under the Event that holds everything that moves it. A process's parent is the process of the nearest
  // Event above its own that has one.
  const homeOfScaffold = new Map();
  for (const event of mm.events ?? []) for (const id of event.process_ids ?? []) {
    if (!String(id).startsWith('profile.')) continue; const known = homeOfScaffold.get(id);
    if (!known || (depthOf.get(event.id) ?? 0) < (depthOf.get(known) ?? 0)) homeOfScaffold.set(id, event.id);
  }
  const processAt = new Map(); for (const [id, eventId] of homeOfScaffold) if (!processAt.has(eventId)) processAt.set(eventId, id);
  const processAbove = (eventId) => { for (let at = eventId, hops = 0; at && hops < 64; at = parentOf(at), hops += 1) if (processAt.has(at)) return processAt.get(at); return null; };
  const chainOf = (id) => { const chain = []; for (let at = id; at && chain.length < 64; at = parentOf(at)) chain.push(at); return chain; };
  const commonAncestor = (ids) => { if (!ids.length) return null; let common = chainOf(ids[0]); for (const id of ids.slice(1)) { const up = new Set(chainOf(id)); common = common.filter((item) => up.has(item)); } return common[0] ?? null; };
  const byFirstName = new Map(people.map((person) => [person.name.split(' ')[0].toLowerCase(), person]));
  const processes = (model.processes ?? []).map((process) => {
    const id = String(process.id); const scaffold = id.startsWith('profile.'); const support = (process.support ?? []).join(' ; ');
    const movers = events.filter((event) => event.processIds.includes(id)).map((event) => event.id);
    let home = homeOfScaffold.get(id) ?? null;
    if (!scaffold) {
      const prefix = id.split('.')[0].toLowerCase(); const frame = String(process.reference_frame ?? '').match(/^person:(.+)$/)?.[1]?.toLowerCase();
      const person = byFirstName.get(frame) ?? byFirstName.get(prefix); const thing = referents.find((referent) => referent.life && referent.id.split('.').at(-1) === prefix);
      const common = commonAncestor(movers);
      home = person?.life?.eventId ?? thing?.life ?? (common && (depthOf.get(common) ?? 0) > 0 ? common : treeRoots[0] ?? null);
    }
    const role = process.scale?.semantic_role ?? null;
    return { id, kind: scaffold ? 'scaffold' : 'named', role: scaffold ? role : null, what: scaffold ? null : clip(role, 240), unit: process.unit ?? null, frame: process.reference_frame ?? null,
      support: clip(support, 600), points: scaffold ? [] : pathOf(support).map(({ t, v }) => ({ t: +t.toFixed(4), v })), home,
      parent: scaffold ? processAbove(parentOf(home)) : processAbove(home), depth: (depthOf.get(home) ?? 0) + (scaffold ? 0 : 1), owner: home ? ownerOf(home) : null,
      events: movers, born: birthOf('processes', id) };
  });

  // The lenses, as the tool reads them from the graph (a checkout that has lenses), else read here the same way: every lens
  // node that no later version supersedes, and the built-in one. A lens's readings are the Cuts whose ids begin
  // lens.<lens>.; the built-in lens also counts Cuts that asked it in their own words before lenses had ids. A reading
  // whose answers are not the lens's present answers was given to an earlier version of it.
  const graphView = { nodes: [...nodes.values()], edges: [...edges.values()] };
  const lensList = readLenses(graphView);
  const liveCuts = allCuts.filter((cut) => !cut.withdrawn);
  // A reading's record: what its reading Event is about, or, before placement, the Event it sits on.
  const recordOf = (cut) => readingEvents.get(cut.parent_event_id)?.about[0] ?? cut.parent_event_id;
  const lenses = lensList.map((lens) => {
    const own = liveCuts.filter((cut) => String(cut.id).startsWith(`lens.${lens.id}.`)); const answered = new Set(own.map(recordOf));
    // Cuts that asked the built-in lens in their own words, before lenses had ids: shown, but whose reading they are is not
    // stated, and a decision's Cut (continuations and their weights) is never a reading.
    const older = lens.matchesQuestion ? liveCuts.filter((cut) => !String(cut.id).startsWith('lens.') && lens.matchesQuestion.test(String(cut.question ?? '')) && !answered.has(cut.parent_event_id)
      && cutKind(cut) !== 'decision' && !drawOf.has(cut.id)) : [];
    const keys = lens.answers ? new Set([...lens.answers.map((answer) => answer.key), 'remainder']) : null;
    const readings = [...own, ...older].map((cut) => {
      const provenance = (cut.provenance ?? []).join(' ; '); const placed = readingEvents.get(cut.parent_event_id) ?? null; const record = recordOf(cut);
      return { cutId: cut.id, eventId: record, t: toYear(start(index.events.get(record))), question: clip(cut.question, 220), unit: cut.unit ?? null,
        answers: (cut.answers ?? []).slice().sort((a, b) => b.weight - a.weight).map((answer) => ({ key: answer.key, weight: +answer.weight.toFixed(4) })),
        // Whose reading it is: the holder it sits beneath, else (before placement) the lens's holder; unknown for older Cuts.
        holder: placed ? placed.holder : own.includes(cut) ? lens.holder ?? null : null, perspective: placed ? placed.perspective : own.includes(cut) ? 'modeler' : null,
        placed: Boolean(placed), ...(placed ? { readingEventId: placed.id, context: placed.context } : {}),
        ...(own.includes(cut) ? {} : { older: true }), ...(keys && (cut.answers ?? []).some((answer) => !keys.has(answer.key)) ? { earlier: true } : {}),
        confidence: Number(provenance.match(/confidence ([\d.]+)/)?.[1] ?? NaN) || null, estimated: /^estimator:/.test(provenance), provenance: clip(provenance, 300), born: birthOf('cuts', cut.id) };
    }).sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
    return { id: lens.id, name: lens.name ?? lens.id, question: lens.question ?? null, appliesTo: lens.appliesTo ?? [], answers: lens.answers ?? null, why: clip(lens.why, 900) || null,
      holder: lens.holder ?? null, perspective: lens.perspective ?? 'modeler',
      source: clip(lens.source, 400) || null, trajectory: clip(lens.trajectory, 400) || null, builtIn: Boolean(lens.builtIn), nodeId: lens.nodeId ?? null, version: lens.version ?? 1,
      about: (lens.about ?? []).map((target) => target.id), readings };
  }).filter((lens) => lens.readings.length || !lens.builtIn);
  // Notes about a life or a process sit at the Event that holds it.
  for (const edge of graphEdges) {
    if (edge.target?.anchorKind === 'referent') edge.target.home = referents.find((referent) => referent.id === edge.target.anchor)?.life ?? null;
    if (edge.target?.anchorKind === 'process') edge.target.home = processes.find((process) => process.id === edge.target.anchor)?.home ?? null;
  }

  // ---- the story's text, from the render ------------------------------------------------------------------------------------------
  const story = rendered && !rendered.error ? { projectionHash: rendered.projection_hash ?? null,
    units: (rendered.units ?? []).map((unit) => ({ id: unit.node_id, type: unit.node_type ?? null, role: unit.role ?? null, title: unit.title ?? null, text: String(unit.text ?? ''), born: nodeBorn.get(unit.node_id) ?? null })) } : null;
  // Keep the render's reading order. A passage is placed in world time only by its declared renders links.
  if (story) story.units = placeStoryUnits(story.units, [...edges.values()], events);
  const proseTimes = story?.units.flatMap((unit) => [unit.t, unit.end]).filter(Number.isFinite) ?? [];
  const storyWindow = proseTimes.length >= 2 ? { start: Math.min(...proseTimes), end: Math.max(...proseTimes) } : window;
  const storyTitle = story?.units.map((unit) => unit.text.match(/^#\s+(.+)$/m)?.[1]?.trim()).find(Boolean) ?? null;
  const storyWords = story ? story.units.reduce((sum, unit) => sum + countProseWords(unit.text), 0) : null;
  const documentProjection = rendered?.join_policy === 'blank_line' && rendered.roots?.length === 1
    ? projectDocument({ rendered, nodes: [...nodes.values()], edges: [...edges.values()], rootId: rendered.roots[0] }) : null;
  const data = {
    // The story's own title, from its document in the graph; else the chosen world's.
    schema: 'meaning-model-viewer/2', runFormat: null, meaningModel: meaningModelVersion, readingsPlaced: readingEvents.size > 0,
    generatedAt, run: runName, title: requestedTitle ?? display?.title ?? storyTitle ?? title ?? runName, display,
    contexts: (mm.context_roots ?? []).map((root) => ({ eventId: root.event_id, kind: root.kind, holder: rootHolder(root.event_id), label: clip(index.events.get(root.event_id)?.boundary, 160) })),
    timeUnit: unit, firstCall, lastCall: calls.at(-1)?.at ?? null, headGraphHash: history.headGraphHash ?? null, modelHash: selectedModelEntry.modelHash,
    window, extent, storyWindow, storyRoute, people, events, relations, draws, referents, processes, lenses,
    graph: { nodes: graphNodes, edges: graphEdges }, story, documentProjection, measures, steps, toolCalls,
    totals: { events: events.length, cuts: allCuts.length - withdrawn.size, people: people.length, lives: lives.length, thoughts: graphNodes.filter((node) => node.category === 'thought').length,
      passages: graphNodes.filter((node) => node.category === 'passage').length, words: storyWords ?? graphNodes.reduce((sum, node) => sum + node.words, 0), modelRevisions: history.models.length, graphRevisions: history.revisions.length },
  };

  // The calendar scene needs numeric paths. Other models remain fully inspectable without invented dates or values.
  const plottedTimes = measures.filter((measure) => measure.points.length >= 2).flatMap((measure) => measure.points.map((point) => point.t));
  const first = Number.isFinite(display?.from) ? display.from : Number.isFinite(storyWindow?.start) ? storyWindow.start - 0.4 : -Infinity;
  const viewStart = Math.max(Math.min(...plottedTimes), first); const viewEnd = Math.max(...plottedTimes) + 0.12;
  const hasStory = story?.units.some((item) => item.role !== 'document_root' && item.text.trim());
  data.viewKind = calendarTime && hasStory && Number.isFinite(viewStart) && Number.isFinite(viewEnd) && viewStart < viewEnd ? 'timeline' : 'inspector';
  data.constructionTiming = steps.some((step) => Number.isFinite(Date.parse(step.at))) ? 'available' : 'unavailable';
  data.inspection = structuredClone({ model, graph: { id: history.graphId ?? null, nodes: [...nodes.values()], edges: [...edges.values()] } });
  return data;
}
