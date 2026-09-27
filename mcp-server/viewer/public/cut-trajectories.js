// Display comparisons of compatible recorded Cuts. These rows are visual guides,
// not new process measurements or laws; each anchor retains its whole source Cut.
export function cutTrajectories(data) {
  const model = data?.inspection?.model;
  if (!model?.meaning_model || !Array.isArray(data?.numerics?.cuts)) return [];
  const mm = model.meaning_model;
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const referents = new Map((mm.referents ?? []).map((referent) => [referent.id, referent]));
  const displayNames = new Map([...(data.referents ?? []), ...(data.people ?? [])].filter((item) => item.name).map((item) => [item.id, item.name]));
  const nativeCuts = new Map((mm.normalized_cuts ?? []).map((cut) => [cut.id, cut]));
  const parents = new Map(), lives = new Map(), bindings = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const relation of mm.event_relations ?? []) if (relation.kind === 'contains') add(parents, relation.target_event_id, relation.source_event_id);
  for (const referent of referents.values()) if (referent.lifecycle_event_id) add(lives, referent.lifecycle_event_id, referent.id);
  for (const binding of mm.event_referent_bindings ?? []) if (binding.target?.kind === 'event') add(bindings, binding.target.event_id, binding);
  const sorted = (values) => [...new Set(values)].sort();
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Resolve the first matching declaration on EVERY containment branch. A
  // shorter path must not conceal a different owner reached by a longer one.
  const branches = (start, lookup) => {
    const found = new Map(), visited = new Set(), active = new Set();
    let unresolved = false, invalid = false;
    const pending = [{ id: start, exit: false }];
    while (pending.length) {
      const { id, exit } = pending.pop();
      if (exit) { active.delete(id); continue; }
      if (active.has(id)) { invalid = true; continue; }
      if (visited.has(id)) continue;
      visited.add(id);
      const event = events.get(id);
      if (!event) { invalid = true; continue; }
      const value = lookup(event);
      if (value?.length) { const key = JSON.stringify(sorted(value)); found.set(key, sorted(value)); continue; }
      const above = parents.get(id) ?? [];
      if (!above.length) unresolved = true;
      active.add(id); pending.push({ id, exit: true });
      for (const parent of [...above].reverse()) pending.push({ id: parent, exit: false });
    }
    return { values: [...found.values()], unresolved, invalid };
  };

  const identityCache = new Map();
  const identityOf = (id) => {
    if (identityCache.has(id)) return identityCache.get(id);
    const event = events.get(id);
    const declared = [...(bindings.get(id) ?? []).map((binding) => binding.referent_id), ...Object.values(event?.participants ?? {}).flat()];
    const direct = sorted(declared);
    const lineage = branches(id, (ancestor) => lives.get(ancestor.id));
    const inherited = sorted(lineage.values.flat());
    const process = branches(id, (ancestor) => ancestor.process_ids);
    let result = null;
    if (event && direct.every((value) => referents.has(value)) && direct.length <= 1 && inherited.length <= 1 && !lineage.invalid
      && (!direct.length || !inherited.length || direct[0] === inherited[0])
      && (direct.length === 1 || (inherited.length === 1 && !lineage.unresolved))
      && !process.invalid && process.values.length <= 1 && !(process.values.length && process.unresolved)) {
      result = { owner: direct[0] ?? inherited[0], processScope: process.values[0] ?? [] };
    }
    identityCache.set(id, result);
    return result;
  };
  const contextKey = (record) => record.contextStatus === 'declared' && record.contexts?.length === 1 && !(record.contextIssues?.length)
    ? record.contexts.map((context) => ({ rootId: context.rootId, kind: context.kind, holder: context.holder ?? null })) : null;
  const answerKeys = (record) => {
    const answers = record.answers ?? [];
    const keys = sorted(answers.map((answer) => answer.key));
    return answers.length && keys.length === answers.length && keys.includes('remainder')
      && answers.every((answer) => typeof answer.key === 'string' && Number.isFinite(answer.weight) && answer.weight >= 0 && answer.weight <= 1)
      && Math.abs(answers.reduce((sum, answer) => sum + answer.weight, 0) - 1) <= 1e-9 ? keys : null;
  };
  const conditionSchema = (record) => {
    const chain = record.conditioningChain ?? [];
    if (Boolean(record.conditioning) !== Boolean(chain.length)) return null;
    const schema = [];
    for (const parent of chain) {
      const identity = identityOf(parent.parentEventId), contexts = contextKey(parent), keys = answerKeys(parent);
      if (parent.status !== 'resolved' || parent.withdrawn || !identity || !contexts || !keys || !keys.includes(parent.answerKey)
        || typeof parent.question !== 'string' || typeof parent.unit !== 'string') return null;
      schema.push({ ...identity, question: parent.question, unit: parent.unit, answerKey: parent.answerKey, answerKeys: keys, contexts });
    }
    return schema;
  };
  const ancestorCache = new Map();
  const ancestors = (id) => {
    if (ancestorCache.has(id)) return ancestorCache.get(id);
    const distances = new Map(), queue = [[id, 0]];
    for (let i = 0; i < queue.length; i += 1) {
      const [current, distance] = queue[i];
      if (distances.has(current)) continue;
      distances.set(current, distance);
      for (const parent of parents.get(current) ?? []) queue.push([parent, distance + 1]);
    }
    ancestorCache.set(id, distances); return distances;
  };
  const commonHome = (records, owner) => {
    const maps = records.map((record) => ancestors(record.parentEventId));
    const common = [...maps[0]].filter(([id]) => maps.every((map) => map.has(id)))
      .map(([id]) => ({ id, distance: Math.max(...maps.map((map) => map.get(id))) }));
    if (!common.length) return null;
    const nearest = Math.min(...common.map((item) => item.distance));
    const candidates = common.filter((item) => item.distance === nearest);
    if (candidates.length === 1) return candidates[0].id;
    const life = referents.get(owner)?.lifecycle_event_id;
    return life && common.some((item) => item.id === life) ? life : null;
  };

  const groups = new Map();
  for (const cut of data.numerics.cuts) {
    const native = nativeCuts.get(cut.id), identity = identityOf(cut.parentEventId), contexts = contextKey(cut);
    const keys = answerKeys(cut), conditioningSchema = conditionSchema(cut);
    if (!native || native.withdrawn || cut.record?.withdrawn || !cut.displayable || !Number.isFinite(cut.t) || !Number.isFinite(cut.end)
      || cut.end < cut.t || !identity || !contexts || !keys || !conditioningSchema
      || typeof cut.question !== 'string' || typeof cut.unit !== 'string'
      || native.parent_event_id !== cut.parentEventId || native.question !== cut.question || native.unit !== cut.unit
      || !equal([...native.answers].sort((a, b) => a.key.localeCompare(b.key)), [...cut.answers].sort((a, b) => a.key.localeCompare(b.key)))) continue;
    const schema = { ...identity, question: cut.question, unit: cut.unit, answerKeys: keys, contexts, conditioningSchema };
    const key = JSON.stringify(schema);
    if (!groups.has(key)) groups.set(key, { schema, records: [] });
    groups.get(key).records.push(cut);
  }
  const rows = [];
  for (const [key, { schema, records }] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    records.sort((a, b) => a.t - b.t);
    // A duplicate time is not resolved by averaging or choosing whichever record
    // happened to arrive first. Both records remain in the independent Cut view.
    if (records.length < 2 || records.some((record, i) => i && record.t === records[i - 1].t)) continue;
    const referent = referents.get(schema.owner), home = commonHome(records, schema.owner);
    for (const answerKey of schema.answerKeys) rows.push({
      id: `cut-answer:${encodeURIComponent(JSON.stringify([key, answerKey]))}`,
      label: `${answerKey} · ${schema.question}`, kind: 'cut-answer', answerKey, question: schema.question, unit: schema.unit,
      owner: schema.owner, group: { id: schema.owner, label: displayNames.get(schema.owner) ?? referent?.boundary ?? schema.owner }, home, depth: 1,
      range: [0, 1], domain: [records[0].t, records.at(-1).t], sourceEventIds: sorted(records.map((record) => record.parentEventId)),
      contexts: structuredClone(records[0].contexts), conditioningSchema: structuredClone(schema.conditioningSchema),
      processScope: [...schema.processScope],
      interpolation: { kind: 'linear-visual-guide', samplePosition: 'interval-start', extrapolate: false },
      points: records.map((cut) => ({ t: cut.t, v: cut.answers.find((answer) => answer.key === answerKey).weight,
        cutId: cut.id, eventId: cut.parentEventId, end: cut.end, interval: structuredClone(cut.interval), born: structuredClone(cut.born ?? null), cut: structuredClone(cut) })),
    });
  }
  return rows;
}
