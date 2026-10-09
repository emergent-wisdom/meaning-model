// Each Event's best importance rank across the model's scales and holders (1 is a scale's top level), for choosing
// which Events to name first when a report points to several.
export function importanceRanks(mm) {
  const ranks = new Map();
  for (const scale of mm?.importance_scales ?? []) {
    for (const judgment of (mm?.event_importance ?? []).filter((item) => item.scale_id === scale.id)) {
      const rank = (scale.levels ?? []).findIndex((level) => level.key === judgment.level) + 1;
      if (rank > 0) ranks.set(judgment.event_id, Math.min(ranks.get(judgment.event_id) ?? Infinity, rank));
    }
  }
  return ranks;
}
