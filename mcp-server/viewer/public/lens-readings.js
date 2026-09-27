// A lens's readings as the acts they read. A deeper reading divides one answer of another reading (its Cut is
// conditioned on that answer), so it is shown inside that answer, never beside it as a second reading of the act.
// Its shares are of that answer only: its joint share of the act is the answer's weight times its own.

// Each reading that no other reading of the lens contains, with the deeper readings inside it (`within`, recursively).
// A reading conditioned on a Cut or answer the lens does not show, or caught in a conditioning cycle, stands as its own act.
export function readingActs(readings = []) {
  const byCut = new Map(readings.map((reading) => [reading.cutId, { ...reading, within: [] }]));
  const parentOf = (reading) => {
    const parent = reading.conditioning ? byCut.get(reading.conditioning.cutId) : null;
    return parent && parent !== reading && (parent.answers ?? []).some((answer) => answer.key === reading.conditioning.answerKey) ? parent : null;
  };
  const inCycle = (reading) => {
    const seen = new Set([reading]);
    for (let at = parentOf(reading); at; at = parentOf(at)) { if (seen.has(at)) return true; seen.add(at); }
    return false;
  };
  const acts = [];
  for (const reading of byCut.values()) {
    const parent = inCycle(reading) ? null : parentOf(reading);
    if (parent) parent.within.push(reading); else acts.push(reading);
  }
  return acts;
}

const order = (a, b) => (a.key === 'remainder') - (b.key === 'remainder') || b.weight - a.weight;

// Every share of an act as it is drawn: each answer, divided by the deeper reading within it down to its own answers,
// in order (the remainder last at each level). `family` is the top-level answer a share belongs to, as `keyOf` names
// it; `depth` counts the readings above it; a share never carries a weight that was not declared or multiplied out.
export function actShares(act, keyOf = (key) => key) {
  const shares = [];
  const walk = (reading, scale, path) => {
    for (const answer of [...(reading.answers ?? [])].sort(order)) {
      const weight = answer.weight * scale; if (!(weight > 0)) continue;
      const deeper = (reading.within ?? []).find((item) => item.conditioning?.answerKey === answer.key);
      if (deeper) walk(deeper, weight, [...path, answer.key]);
      else shares.push({ key: answer.key, path: [...path, answer.key], family: path.length ? keyOf(path[0]) : keyOf(answer.key), depth: path.length, weight });
    }
  };
  walk(act, 1, []);
  return shares;
}

// How many acts a lens has read, and how many of them it read deeper.
export function actCounts(acts = []) {
  return { acts: acts.length, deeper: acts.filter((act) => act.within?.length).length };
}
