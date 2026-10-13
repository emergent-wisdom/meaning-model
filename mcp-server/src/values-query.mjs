// Read a model's dated values without reading the model. Agents that needed one process's values over a stretch of time
// used to export the whole definition and search it; this answers that question directly, with each point exactly as
// the model holds it (a number with its band, or a named state, with its tag and note), and says what it left out and
// how to get it.
import * as z from 'zod/v4';
import { questionModel } from './model-questions.mjs';
import { extent } from './arrays.mjs';

const id = z.string().trim().min(1).max(512);
export const valuesQuerySchema = z.object({
  modelHash: z.string().regex(/^[a-f0-9]{64}$/u),
  processIds: z.array(id).max(32).default([])
    .describe('The processes whose values to read. Leave empty to list the measures (ids, labels, units, how many values and over what span), filtered by text.'),
  text: z.string().trim().min(1).max(200).optional()
    .describe('With no processIds: list only the processes whose id, label or meaning contains every word.'),
  from: z.number().finite().optional().describe('Earliest model time to include.'),
  to: z.number().finite().optional().describe('Latest model time to include.'),
  maxPoints: z.number().int().min(2).max(400).default(60)
    .describe('Most values per series. Longer series are thinned: always the first and last, then the lowest and highest of a number or every change of a named state, then evenly spaced; the result says when it thinned and what it kept.'),
  accessScopes: z.array(id).max(64).default([]),
}).strict();

const words = (text) => String(text ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
const label = (process) => process?.scale?.label ?? null;
const hasStates = (points) => points.some((p) => p.state !== undefined);
// Where a named state differs from the one before it.
const stateChanges = (points) => points.map((p, i) => i).filter((i) => i > 0 && points[i].state !== points[i - 1].state);

// Thin a sorted list to at most max entries. First what matters most: the first and last, then for a number the lowest
// and highest, for a named state every change of state (spread evenly when not all fit); then the middle of the widest
// remaining gap, again and again, so the kept points spread evenly over the stretch.
export function thin(points, max) {
  if (points.length <= max) return points;
  let marks;
  if (hasStates(points)) marks = [0, points.length - 1, ...stateChanges(points)];
  else {
    let low = 0, high = 0;
    points.forEach((p, i) => { if (p.value < points[low].value) low = i; if (p.value > points[high].value) high = i; });
    marks = [0, points.length - 1, low, high];
  }
  marks = [...new Set(marks)].sort((a, b) => a - b);
  if (marks.length > max) {
    const inner = marks.slice(1, -1);
    marks = [marks[0], ...Array.from({ length: max - 2 }, (_, k) => inner[Math.floor(((k + 0.5) * inner.length) / (max - 2))]), marks.at(-1)];
  }
  const keep = new Set(marks);
  while (keep.size < max) {
    const sorted = [...keep].sort((a, b) => a - b);
    let widest = 0;
    for (let i = 1; i < sorted.length - 1; i += 1) if (sorted[i + 1] - sorted[i] > sorted[widest + 1] - sorted[widest]) widest = i;
    // While fewer values are kept than exist, some gap spans at least two places, so its middle is new.
    keep.add(Math.floor((sorted[widest] + sorted[widest + 1]) / 2));
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

export async function queryValues(service, raw) {
  const input = valuesQuerySchema.parse(raw);
  const { model: stored } = await service.inspectModel({ modelHash: input.modelHash, includeDefinition: true });
  const model = questionModel(stored, input.accessScopes);
  const processes = new Map((model.processes ?? []).map((process) => [process.id, process]));
  const series = model.value_series ?? [];
  const within = (p) => (input.from === undefined || p.time >= input.from) && (input.to === undefined || p.time <= input.to);
  const range = input.from !== undefined || input.to !== undefined ? { from: input.from ?? null, to: input.to ?? null } : null;

  if (!input.processIds.length) {
    // A directory of the measures: enough to choose which to read.
    const wanted = words(input.text);
    // Each process's series found once, not by scanning every series for every process.
    const seriesOf = new Map();
    for (const item of series) { if (!seriesOf.has(item.process_id)) seriesOf.set(item.process_id, []); seriesOf.get(item.process_id).push(item); }
    const listed = [...processes.values()].filter((process) => {
      if (!wanted.length) return true;
      const haystack = `${process.id} ${label(process) ?? ''} ${process.scale?.semantic_role ?? ''}`.toLowerCase();
      return wanted.every((word) => haystack.includes(word));
    }).map((process) => {
      const own = seriesOf.get(process.id) ?? [];
      const times = own.flatMap((item) => (item.points ?? []).filter(within).map((p) => p.time));
      return { processId: process.id, label: label(process), unit: process.unit ?? null, series: own.length, values: times.length,
        ...(times.length ? { span: extent(times) } : {}) };
    });
    return { schema: 'meaning-model-values/v1', modelHash: input.modelHash, ...(range ? { range } : {}),
      processes: listed.slice(0, 200), ...(listed.length > 200 ? { moreProcesses: listed.length - 200 } : {}),
      next: 'Read values with processIds (and from/to for a stretch of time).' };
  }

  const asked = [...new Set(input.processIds)];
  const missing = asked.filter((processId) => !processes.has(processId));
  const found = asked.filter((processId) => processes.has(processId));
  const out = [];
  for (const processId of found) {
    const process = processes.get(processId);
    for (const item of series.filter((s) => s.process_id === processId)) {
      const all = [...(item.points ?? [])].filter(within).sort((a, b) => a.time - b.time);
      const kept = thin(all, input.maxPoints);
      let thinned = null;
      if (kept.length < all.length) {
        if (hasStates(all)) {
          const changes = stateChanges(all);
          const shown = new Set(kept);
          thinned = { shown: kept.length, of: all.length, rule: 'the first and last, every change of state that fits, then evenly spaced',
            changesOfState: changes.length, changesOfStateShown: changes.filter((i) => shown.has(all[i])).length };
        } else thinned = { shown: kept.length, of: all.length, rule: 'evenly spaced, plus the first, last, lowest and highest' };
      }
      out.push({ processId, label: label(process), unit: process.unit ?? null, ...(item.holder ? { holder: item.holder } : {}), seriesId: item.id,
        values: all.length, ...(thinned ? { thinned } : {}), points: kept.map((p) => ({ ...p })) });
    }
  }
  // Say how much else there is to read, so values for a few measures are not taken for the whole model.
  const others = processes.size - found.length;
  return { schema: 'meaning-model-values/v1', modelHash: input.modelHash, ...(range ? { range } : {}), series: out,
    ...(missing.length ? { notVisible: missing, notVisibleReason: 'Not a process of this model, or not visible with these accessScopes.' } : {}),
    otherProcesses: others, ...(others ? { next: 'Leave processIds empty for the directory of every measure.' } : {}) };
}
