// A display plan for declared containment, independent of dates, camera and model identity.
// Lanes are local to each group; callers reserve at least spans.get(group).lanes slots.
// Levels follow the nearest visible ancestor across groups. The model records are never changed.
export function nestedEventLayout({ events = [], visibleIds, subjects = [] } = {}) {
  const records = new Map();
  for (const event of events) if (typeof event?.id === 'string' && !records.has(event.id)) records.set(event.id, event);
  const ids = [...records.keys()].sort();
  const visible = new Set([...(visibleIds ?? ids)].filter((id) => records.has(id)));
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const lives = new Map();
  for (const subject of subjects) if (subject.lifeEventId) {
    if (!lives.has(subject.lifeEventId)) lives.set(subject.lifeEventId, new Set());
    lives.get(subject.lifeEventId).add(subject.id);
  }
  const parent = new Map(ids.map((id) => [id, records.has(records.get(id).parent) ? records.get(id).parent : null]));
  // Invalid cyclic input cannot form a tree. Cut one display edge at the smallest ID in each cycle.
  const visited = new Set();
  for (const id of ids) {
    const path = [], index = new Map(); let at = id;
    while (at !== null && !visited.has(at)) {
      if (index.has(at)) { parent.set(path.slice(index.get(at)).sort()[0], null); break; }
      index.set(at, path.length); path.push(at); at = parent.get(at);
    }
    for (const item of path) visited.add(item);
  }

  const nearest = (lookup) => {
    const cache = new Map();
    return (id) => {
      const path = []; let at = id, result = null;
      while (at !== null) {
        if (cache.has(at)) { result = cache.get(at); break; }
        const own = lookup(at);
        if (own !== undefined) { result = own; cache.set(at, own); break; }
        path.push(at); at = parent.get(at);
      }
      for (const item of path) cache.set(item, result);
      return result;
    };
  };
  // Containment in a person's declared lifecycle takes precedence over an owner hint.
  // Conflicting lifecycle subjects stay unassigned rather than choosing a person arbitrarily.
  const lifecycle = nearest((id) => lives.has(id) ? lives.get(id).size === 1 ? [...lives.get(id)][0] : 'world' : undefined);
  const owner = nearest((id) => subjectIds.has(records.get(id).owner) ? records.get(id).owner : undefined);
  const groupById = new Map(ids.map((id) => [id, lifecycle(id) ?? owner(id) ?? 'world']));
  const nearestVisible = nearest((id) => visible.has(id) ? id : undefined);
  const visibleParent = new Map([...visible].map((id) => [id, nearestVisible(parent.get(id))]));
  const levels = new Map();
  for (const id of visible) {
    const path = []; let at = id;
    while (at !== null && !levels.has(at)) { path.push(at); at = visibleParent.get(at); }
    let level = at === null ? -1 : levels.get(at);
    for (let i = path.length - 1; i >= 0; i -= 1) levels.set(path[i], ++level);
  }

  const compare = (a, b) => {
    const first = records.get(a).t0, second = records.get(b).t0;
    const ta = Number.isFinite(first) ? first : Infinity, tb = Number.isFinite(second) ? second : Infinity;
    return (ta < tb ? -1 : ta > tb ? 1 : 0) || (a < b ? -1 : a > b ? 1 : 0);
  };
  const children = new Map(), roots = new Map();
  for (const id of visible) {
    const above = visibleParent.get(id), group = groupById.get(id);
    const bucket = above !== null && groupById.get(above) === group ? children : roots;
    const key = bucket === children ? above : group;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(id);
  }
  for (const list of [...children.values(), ...roots.values()]) list.sort(compare);
  const positions = new Map(), spans = new Map();
  const order = [...new Set([...subjectIds, 'world', ...roots.keys()])];
  for (const group of order) {
    if (!roots.has(group)) continue;
    let lane = 0;
    for (const root of roots.get(group)) {
      const pending = [[root, false]];
      while (pending.length) {
        const [id, complete] = pending.pop(), below = children.get(id) ?? [];
        if (!complete && below.length) {
          pending.push([id, true]);
          for (let i = below.length - 1; i >= 0; i -= 1) pending.push([below[i], false]);
        } else {
          const center = below.length ? (positions.get(below[0]).lane + positions.get(below.at(-1)).lane) / 2 : lane++;
          positions.set(id, { group, level: levels.get(id), lane: center });
        }
      }
    }
    spans.set(group, { lanes: lane });
  }
  return { positions, groupById, spans };
}
