// Detail is a projection of declared containment and recorded rows. It never
// estimates a summary value or combines quantities from different processes.
export function createProcessDetail(events = [], rows = []) {
  const byId = new Map(events.filter((event) => typeof event?.id === 'string' && event.id).map((event) => [event.id, event]));
  const children = new Map([...byId.keys()].map((id) => [id, []]));
  const roots = new Set();
  for (const event of byId.values()) {
    if (byId.has(event.parent) && event.parent !== event.id) children.get(event.parent).push(event.id);
    else roots.add(event.id);
  }

  // A malformed cycle has no root. Give every cycle member a traversal start,
  // preserving its declared parent rather than inventing a containment edge.
  const checked = new Set();
  for (const id of byId.keys()) {
    const path = [], positions = new Map();
    let current = id;
    while (byId.has(current) && !checked.has(current)) {
      if (positions.has(current)) {
        for (const member of path.slice(positions.get(current))) roots.add(member);
        break;
      }
      positions.set(current, path.length); path.push(current);
      current = byId.get(current).parent;
    }
    for (const member of path) checked.add(member);
  }

  function distancesFrom(starts) {
    const distances = new Map([...starts].map((id) => [id, 0]));
    const pending = [...starts];
    for (let index = 0; index < pending.length; index += 1) {
      const id = pending[index];
      for (const child of children.get(id) ?? []) if (!distances.has(child)) {
        distances.set(child, distances.get(id) + 1); pending.push(child);
      }
    }
    return distances;
  }

  const worldDistances = distancesFrom(roots);
  const recordedRows = rows.filter((row) => typeof row?.measure?.id === 'string').map((row) => ({
    id: row.measure.id,
    home: row.home ?? row.measure.home,
    depth: Number.isFinite(row.depth) ? Math.max(0, row.depth) : 1,
    conditions: Array.isArray(row.measure.conditioningSchema) ? row.measure.conditioningSchema.length : 0,
  }));
  const rowHomes = new Set(recordedRows.map((row) => row.home));
  const rootRoles = new Set(['life', 'world', 'inner', 'slow']);
  const options = [...byId.values()].filter((event) => children.get(event.id).length || rootRoles.has(event.role) || rowHomes.has(event.id))
    .map((event) => ({ id: event.id, label: String(event.name || event.label || event.id), depth: worldDistances.get(event.id) ?? 0 }));

  function project({ scope = null, level = 0 } = {}) {
    scope = byId.has(scope) ? scope : null;
    const ancestors = new Set();
    if (scope !== null) {
      let parent = byId.get(scope).parent;
      while (byId.has(parent) && parent !== scope && !ancestors.has(parent)) {
        ancestors.add(parent); parent = byId.get(parent).parent;
      }
    }
    const distances = scope === null ? worldDistances : distancesFrom([scope]);
    // Keep the selected whole and its context even when a separate display
    // filter hides unopened branches exposed by a later detail level.
    const retainedEventIds = scope === null
      ? new Set([...worldDistances].filter(([, distance]) => distance <= 1).map(([id]) => id))
      : new Set([...ancestors, scope]);
    const includedRows = scope === null ? recordedRows : recordedRows.filter((row) => distances.has(row.home));
    const unconditioned = includedRows.filter((row) => row.conditions === 0);
    const nearest = scope === null || includedRows.length === 0 ? 0
      : Math.min(...(unconditioned.length ? unconditioned : includedRows).map((row) => distances.get(row.home)));
    const rowLevels = includedRows.map((row) => ({ id: row.id, level: scope === null
      ? Math.max(1, Math.ceil(row.depth) - 1) + row.conditions
      : Math.max(0, distances.get(row.home) - nearest) + row.conditions }));
    const maxLevel = Math.max(0, ...[...distances.values()].map((distance) => distance - (scope === null ? 1 : 0)), ...rowLevels.map((row) => row.level));
    level = Math.min(maxLevel, Math.max(0, Number.isFinite(level) ? Math.floor(level) : 0));
    const eventIds = new Set(ancestors);
    for (const [id, distance] of distances) if (distance <= level + (scope === null ? 1 : 0)) eventIds.add(id);
    const rowIds = new Set(rowLevels.filter((row) => row.level <= level).map((row) => row.id));
    return { scope, level, maxLevel, eventIds, rowIds, ancestors, retainedEventIds };
  }

  return { options, project };
}
