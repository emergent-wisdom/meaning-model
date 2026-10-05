// The development a work leans on, followed over time: which people have nothing about them read at two dated times,
// and the concrete next action, a life_series_record call prepared from what a life dossier already says.

// The questions to ask at each event that moves a process: the paper's account of anticipation, shocks and adaptation
// across scales, as a pattern of questions rather than a shape every process must follow.
export const changeQuestions = 'At each event that moves it, ask what was developing before; who anticipated or prepared for it, if anyone (without a record of what they expected, anticipation is unknown, so never invent a probability for it); what changed, and for whom; and how each affected process responded over the relevant later timescales, whether it recovered, settled into something new, kept deteriorating or ended.';

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 38) || 'x';

// The structure the helpers below read: Events by id, each Event's containing Event, the referent each lifecycle Event
// belongs to, and the declared context roots.
function structure(model) {
  const mm = model?.meaning_model ?? {};
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const parent = new Map((mm.event_relations ?? []).filter((relation) => relation.kind === 'contains').map((relation) => [relation.target_event_id, relation.source_event_id]));
  const owner = new Map((mm.referents ?? []).filter((referent) => referent.lifecycle_event_id).map((referent) => [referent.lifecycle_event_id, referent.id]));
  const roots = new Map((mm.context_roots ?? []).map((root) => [root.event_id, root.kind]));
  const climb = (eventId, found) => { for (let id = eventId, seen = new Set(); id && !seen.has(id); seen.add(id), id = parent.get(id)) { const hit = found(id); if (hit) return hit; } return null; };
  const subjectOf = (eventId) => [events.get(eventId)?.participants?.subject].flat().find((id) => typeof id === 'string') ?? climb(eventId, (id) => owner.get(id));
  return { mm, events, owner, roots, climb, subjectOf, rootOf: (eventId) => climb(eventId, (id) => (roots.has(id) ? id : null)) };
}

// Subjects with something followed over time: one question, in one unit with one set of answers and in one perspective,
// read at two or more distinct times. Two Cuts on one Event, or incompatible readings, are not a development.
export function followedSubjects(model) {
  const { mm, events, subjectOf, rootOf } = structure(model);
  const starts = new Map();
  for (const cut of mm.normalized_cuts ?? []) {
    if (cut.withdrawn || cut.conditioning) continue;
    const start = events.get(cut.parent_event_id)?.interval?.start;
    if (!Number.isFinite(start)) continue;
    const subject = subjectOf(cut.parent_event_id); if (!subject) continue;
    const answers = (cut.answers ?? []).map((answer) => answer.key).filter((key) => key !== 'remainder').sort();
    const key = JSON.stringify([subject, rootOf(cut.parent_event_id), String(cut.question).trim().toLowerCase(), cut.unit ?? null, answers]);
    if (!starts.has(key)) starts.set(key, new Set());
    starts.get(key).add(start);
  }
  return new Set([...starts].filter(([, times]) => times.size >= 2).map(([key]) => JSON.parse(key)[0]));
}

// The referents the model gives a mind: the holders of its inner perspective roots, named by the root Event's subject
// or by the lifecycle Event that contains the root. Returns holder -> inner root Event id.
export function innerRoots(model) {
  const { mm, events, owner, climb } = structure(model);
  const found = new Map();
  for (const root of (mm.context_roots ?? []).filter((item) => item.kind === 'inner')) {
    const holder = [events.get(root.event_id)?.participants?.subject].flat().find((id) => typeof id === 'string') ?? climb(root.event_id, (id) => owner.get(id));
    if (holder && !found.has(holder)) found.set(holder, root.event_id);
  }
  return found;
}
export const innerHolders = (model) => new Set(innerRoots(model).keys());

// Times on a dossier's clock placed on the model's: a life unit counted from birth is converted to the model's unit and
// placed from the start of the character's life; an absolute time is taken as it is only when its unit is the model's.
// Anything else stays unresolved for the agent to place.
const YEARS_PER = { year: 1, month: 1 / 12, week: 7 / 365.25, day: 1 / 365.25, hour: 1 / 8766 };
const unitOf = (text) => /(year|month|week|day|hour)/iu.exec(String(text ?? ''))?.[1]?.toLowerCase() ?? null;
function clockFor(character, model, born) {
  const from = unitOf(character.lifeTimeUnit); const to = unitOf(model?.time_unit);
  if (/birth|age/iu.test(character.lifeTimeUnit)) {
    if (!from || !to) return { note: `The phases are counted in ${character.lifeTimeUnit}, which cannot be converted to the model's time unit (${model?.time_unit ?? 'none'}): place each reading yourself.` };
    if (!Number.isFinite(born)) return { note: `The phases are counted from birth, and ${character.name} has no dated life in the model: give them one, or place each reading yourself.` };
    return { at: (t) => Number((born + (t * YEARS_PER[from]) / YEARS_PER[to]).toFixed(6)) };
  }
  if (from && from === to) return { at: (t) => t };
  return { note: `The phases are in ${character.lifeTimeUnit}, not the model's time unit (${model?.time_unit ?? 'none'}): place each reading yourself.` };
}

// For each dossier character whose development the model does not yet follow: the dimensions the dossier traces, and a
// life_series_record call for the first of them with one reading per phase, its reason taken from the dossier's state
// for that phase and the development into it. The agent fills in what the dossier cannot say: the categories and
// shares, the request id and the model revision to build on, and, for someone with an inner perspective, where the
// readings belong.
export function developmentFromDossier(dossier, model, { limit = 6 } = {}) {
  const followed = followedSubjects(model);
  const { mm, events } = structure(model);
  const inner = innerRoots(model);
  return dossier.characters.filter((character) => !followed.has(character.characterId)).slice(0, limit).map((character) => {
    const [trend] = character.trends;
    const phases = [...character.phases].sort((a, b) => a.at - b.at);
    const referent = (mm.referents ?? []).find((item) => item.id === character.characterId);
    const lifeEventId = referent?.lifecycle_event_id ?? null;
    const clock = clockFor(character, model, events.get(lifeEventId)?.interval?.start);
    const stateOf = (phaseId) => trend.states.find((state) => state.phaseId === phaseId)?.state ?? '';
    const into = (from, to) => trend.developments.find((step) => step.fromPhaseId === from && step.toPhaseId === to)?.explanation;
    const readings = phases.slice(0, -1).map((phase, i) => ({
      start: clock.at ? clock.at(phase.at) : null, end: clock.at ? clock.at(phases[i + 1].at) : null,
      ...(clock.at ? {} : { phase: { from: phase.at, to: phases[i + 1].at, unit: character.lifeTimeUnit } }),
      why: [`${phase.label}: ${stateOf(phase.id)}`, i ? `It changed because ${into(phases[i - 1].id, phase.id) ?? 'of what the dossier says'}` : null].filter(Boolean).join(' '),
      tag: 'invented', weights: {} }));
    // Beliefs, feelings and expectations belong under the character's inner perspective; their circumstances in the world
    // belong in their life. Which this dimension is, the agent decides.
    const innerRoot = inner.get(character.characterId) ?? null;
    const fill = ['requestId', 'previousModelHash', ...(innerRoot ? ['parentEventId'] : []), 'series.question', 'series.unit', 'series.answers', 'readings[].weights',
      ...(clock.at ? [] : ['readings[].start', 'readings[].end'])];
    return {
      characterId: character.characterId, name: character.name, dimensions: character.trends.map((item) => item.dimension),
      ...(clock.note ? { timeNote: clock.note } : {}),
      ...(innerRoot ? { placement: { inner: innerRoot, world: lifeEventId, rule: `Use the inner perspective (${innerRoot}) when the dimension is what ${character.name} believes, feels or expects, and their life (${lifeEventId}) when it is their circumstances in the world.` } } : {}),
      call: { tool: 'life_series_record', fill,
        note: 'Each call builds on the model revision the previous write returned: pass that modelHash as previousModelHash, and a new requestId.',
        arguments: { requestId: '<a new request id>', previousModelHash: '<the modelHash your latest model write returned>', subject: character.characterId,
          ...(innerRoot ? { parentEventId: `<${innerRoot} or ${lifeEventId}: see placement>` } : {}),
          reason: `Record how ${character.name}'s ${trend.dimension.toLowerCase()} develops across the life the dossier traces.`,
          series: { id: `${slug(character.characterId)}-${slug(trend.id)}`, question: `How does ${character.name}'s ${trend.dimension.toLowerCase()} divide among <the exclusive categories you carve>?`,
            unit: '<the one unit it divides>', answers: [] }, readings } },
    };
  });
}
