// The development a work leans on, followed over time: which people have nothing about them read at two dated times,
// and the concrete next action, a life_series_record call prepared from what a life dossier already says.

// The questions to ask at each event that moves a process: the paper's account of anticipation, shocks and adaptation
// across scales, as a pattern of questions rather than a shape every process must follow.
export const changeQuestions = 'At each event that moves it, ask what was developing before; who anticipated or prepared for it, if anyone (without a record of what they expected, anticipation is unknown, so never invent a probability for it); what changed, and for whom; and how each affected process responded over the relevant later timescales, whether it recovered, settled into something new, kept deteriorating or ended.';

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 38) || 'x';

// Subjects with at least one question read at two dated times: the readings' Events name the subject, or sit inside
// the subject's lifecycle Event.
export function followedSubjects(model) {
  const mm = model?.meaning_model ?? {};
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const parent = new Map((mm.event_relations ?? []).filter((relation) => relation.kind === 'contains').map((relation) => [relation.target_event_id, relation.source_event_id]));
  const owner = new Map((mm.referents ?? []).filter((referent) => referent.lifecycle_event_id).map((referent) => [referent.lifecycle_event_id, referent.id]));
  const subjectOf = (eventId) => {
    const named = [events.get(eventId)?.participants?.subject].flat().find((id) => typeof id === 'string');
    if (named) return named;
    for (let id = eventId, seen = new Set(); id && !seen.has(id); seen.add(id), id = parent.get(id)) if (owner.has(id)) return owner.get(id);
    return null;
  };
  const counts = new Map();
  for (const cut of mm.normalized_cuts ?? []) {
    if (cut.withdrawn || cut.conditioning) continue;
    if (!Number.isFinite(events.get(cut.parent_event_id)?.interval?.start)) continue;
    const subject = subjectOf(cut.parent_event_id); if (!subject) continue;
    const key = JSON.stringify([subject, String(cut.question).trim().toLowerCase()]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 2).map(([key]) => JSON.parse(key)[0]));
}

// The referents the model gives a mind: the holders of its inner perspective roots, named by the root Event's subject
// or by the lifecycle Event that contains the root.
export function innerHolders(model) {
  const mm = model?.meaning_model ?? {};
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const parent = new Map((mm.event_relations ?? []).filter((relation) => relation.kind === 'contains').map((relation) => [relation.target_event_id, relation.source_event_id]));
  const owner = new Map((mm.referents ?? []).filter((referent) => referent.lifecycle_event_id).map((referent) => [referent.lifecycle_event_id, referent.id]));
  const holders = new Set();
  for (const root of (mm.context_roots ?? []).filter((item) => item.kind === 'inner')) {
    let holder = [events.get(root.event_id)?.participants?.subject].flat().find((id) => typeof id === 'string') ?? null;
    for (let id = root.event_id, seen = new Set(); !holder && id && !seen.has(id); seen.add(id), id = parent.get(id)) holder = owner.get(id) ?? null;
    if (holder) holders.add(holder);
  }
  return holders;
}

// For each dossier character whose development the model does not yet follow: the dimensions the dossier traces, and
// a life_series_record call for the first of them with one reading per phase, its reason taken from the dossier's state
// for that phase and the development into it. The agent carves the categories and weighs each phase.
export function developmentFromDossier(dossier, model, { limit = 6 } = {}) {
  const followed = followedSubjects(model);
  const mm = model?.meaning_model ?? {};
  const lifeStart = (id) => {
    const referent = (mm.referents ?? []).find((item) => item.id === id);
    return (mm.events ?? []).find((event) => event.id === referent?.lifecycle_event_id)?.interval?.start;
  };
  return dossier.characters.filter((character) => !followed.has(character.characterId)).slice(0, limit).map((character) => {
    const [trend] = character.trends;
    const phases = [...character.phases].sort((a, b) => a.at - b.at);
    // Phase times are in the dossier's life unit. Times counted from birth are placed on the model's clock from the
    // start of the character's life; otherwise they are taken as the model's own times.
    const fromBirth = /birth|age/iu.test(character.lifeTimeUnit);
    const born = lifeStart(character.characterId);
    const offset = fromBirth && Number.isFinite(born) ? born : 0;
    const placed = !fromBirth || Number.isFinite(born);
    const at = (t) => Number((t + offset).toFixed(6));
    const stateOf = (phaseId) => trend.states.find((state) => state.phaseId === phaseId)?.state ?? '';
    const into = (from, to) => trend.developments.find((step) => step.fromPhaseId === from && step.toPhaseId === to)?.explanation;
    const readings = phases.slice(0, -1).map((phase, i) => ({ start: at(phase.at), end: at(phases[i + 1].at),
      why: [`${phase.label}: ${stateOf(phase.id)}`, i ? `It changed because ${into(phases[i - 1].id, phase.id) ?? 'of what the dossier says'}` : null].filter(Boolean).join(' '),
      tag: 'invented', weights: {} }));
    return {
      characterId: character.characterId, name: character.name, dimensions: character.trends.map((item) => item.dimension),
      ...(placed ? {} : { timeNote: `The phases are in ${character.lifeTimeUnit} and ${character.name} has no dated life in the model: give them one, or convert the times to the model's clock.` }),
      call: { tool: 'life_series_record', fill: ['series.question', 'series.unit', 'series.answers', 'readings[].weights'],
        arguments: { subject: character.characterId, reason: `Record how ${character.name}'s ${trend.dimension.toLowerCase()} develops across the life the dossier traces.`,
          series: { id: `${slug(character.characterId)}-${slug(trend.id)}`, question: `How does ${character.name}'s ${trend.dimension.toLowerCase()} divide among <the exclusive categories you carve>?`,
            unit: '<the one unit it divides>', answers: [] }, readings } },
    };
  });
}
