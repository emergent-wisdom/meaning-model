// Where to go deeper: the deepen check the values report runs after every write.
//
// The process breakdown's step 7 asks, at every process the work reaches, whether carving it into parts would pay
// (the marginal-value rule): deepen where the expected gain beats the cost, above all where uncertainty, brittle
// dependencies and impact are high, and give a process never examined a credit of its own. The check ranks the processes
// that have values and no parts by signals the model already holds, and names each one's reasons; it never blocks.
// - impact: the Events that name the process, weighted by how important they are judged (top level 8, then 4, 2, 1);
// - unexplained: turns, jumps and changes of state with no note and no Event naming the process (from the values report);
// - rough: the share of its values tagged sketch or exploring, or with a band wider than the value itself;
// - height: a process nearer the top of the tree opens the world from the top, so it keeps a lead;
// - unexamined: a credit until the process is carved or kept whole.
// A process kept whole (life_carve_record with keepWhole) drops out while its signals stay as they were recorded, and
// comes back when its Events or unexplained moves have grown by half or more.
import { KEPT_WHOLE_LINE, KEPT_SIGNALS_LINE } from './carve-index.mjs';

const RANK_WEIGHT = [0, 8, 4, 2];
const weightOf = (rank) => (Number.isFinite(rank) ? (RANK_WEIGHT[rank] ?? 1) : 1);
const ROUGH_TAGS = new Set(['sketch', 'exploring']);

// The decisions to keep a process whole, by process: the signals recorded with each, the latest last.
export function keptWhole(model) {
  const kept = new Map();
  for (const relation of model?.meaning_model?.abstract_relations ?? []) {
    if (relation.withdrawn) continue;
    const lines = (relation.provenance ?? []).filter((line) => typeof line === 'string');
    const process = lines.find((line) => line.startsWith(KEPT_WHOLE_LINE))?.slice(KEPT_WHOLE_LINE.length).trim();
    if (!process) continue;
    const signals = Object.fromEntries((lines.find((line) => line.startsWith(KEPT_SIGNALS_LINE))?.slice(KEPT_SIGNALS_LINE.length) ?? '')
      .split(';').map((pair) => pair.split('=')).filter(([key, value]) => key && Number.isFinite(Number(value))).map(([key, value]) => [key.trim(), Number(value)]));
    kept.set(process, { relation: relation.id, events: signals.events ?? 0, unexplained: signals.unexplained ?? 0 });
  }
  return kept;
}

// The signals of every process with values and no parts. Inputs are what the values report already holds:
// candidates [{process, label, depth}], happenings [{id, rank, names: Set}], unexplained [{process}], valued Map.
export function deepenSignals({ candidates, happenings, unexplained, valued }) {
  const moving = new Map();
  for (const event of happenings) for (const id of event.names) {
    const item = moving.get(id) ?? { events: 0, weight: 0, top: 0 };
    item.events += 1; item.weight += weightOf(event.rank); if (event.rank === 1) item.top += 1;
    moving.set(id, item);
  }
  const unexplainedOf = new Map();
  for (const item of unexplained) unexplainedOf.set(item.process, (unexplainedOf.get(item.process) ?? 0) + 1);
  return candidates.map((candidate) => {
    const points = [...(valued.get(candidate.process)?.values() ?? [])];
    const rough = points.filter((p) => ROUGH_TAGS.has(p.tag) || (Number.isFinite(p.lower) && Number.isFinite(p.upper) && Number.isFinite(p.value)
      && p.upper - p.lower > Math.abs(p.value))).length;
    const move = moving.get(candidate.process) ?? { events: 0, weight: 0, top: 0 };
    return { ...candidate, events: move.events, topEvents: move.top, impact: move.weight, unexplained: unexplainedOf.get(candidate.process) ?? 0,
      rough: points.length ? Number((rough / points.length).toFixed(2)) : 0, values: points.length };
  });
}

// The ranking: the processes most worth examining for a carve, each with its reasons, and those kept whole.
export function deepenCheck(model, inputs) {
  const kept = keptWhole(model);
  const signals = deepenSignals(inputs);
  const ranked = []; const keptNow = [];
  for (const item of signals) {
    const decision = kept.get(item.process);
    if (decision) {
      const grown = item.events >= Math.max(decision.events * 1.5, decision.events + 2) || item.unexplained >= Math.max(decision.unexplained * 1.5, decision.unexplained + 2);
      if (!grown) { keptNow.push(item.process); continue; }
    }
    const score = Math.log2(1 + item.impact) + 1.5 * Math.min(item.unexplained, 6) + 3 * item.rough + 3 / (1 + item.depth) + (decision ? 0 : 1);
    ranked.push({ ...item, score: Number(score.toFixed(2)), ...(decision ? { keptWholeBefore: true } : {}) });
  }
  ranked.sort((a, b) => b.score - a.score || a.depth - b.depth || a.process.localeCompare(b.process));
  return { ranked, keptWhole: keptNow, signals };
}

// Why one process is worth examining, in a few words.
export function deepenReasons(item) {
  const reasons = [];
  if (item.events) reasons.push(`${item.events} Event(s) move it${item.topEvents ? `, ${item.topEvents} of them at the top of an importance scale` : ''}`);
  if (item.unexplained) reasons.push(`${item.unexplained} turn(s) or jump(s) with no reason given`);
  if (item.rough >= 0.25) reasons.push(`${Math.round(item.rough * 100)}% of its values sketched, exploring or wider than themselves`);
  if (item.depth <= 1) reasons.push(item.depth === 0 ? 'it is a top of the tree' : 'it sits just below the top');
  if (item.keptWholeBefore) reasons.push('it was kept whole, and its Events or unexplained moves have grown since');
  return reasons.length ? reasons.join('; ') : 'it has not been examined for a carve';
}

// The report's one line: the process to examine first, and two after it.
export function deepenLine(check) {
  const [first, ...rest] = check.ranked;
  if (!first) return null;
  return `Deepen check: is ${first.label} made of parts worth following? ${capital(deepenReasons(first))}. Carve it with life_carve_record (the claim frame, the climb, the four tests), or record why it stays whole (keepWhole in life_carve_record), so it is not asked again until the evidence grows.${rest.length ? ` Next to examine: ${rest.slice(0, 2).map((item) => item.label).join(', ')}.` : ''}`;
}
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
