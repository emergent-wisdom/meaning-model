// The readings that would follow a stretch of a life. Where a question about a subject is read once across years in
// which things happen, the plan lays out readings at a step the agent chooses (a quarter where the work needs detail,
// a year or a life stage before it): each slot nested in one existing reading of the same question, with the shares
// the slots inside it would average to, so the agent writes what happened in each and how the shares moved, and the
// long view holds or is revised openly where the detail shows it was wrong. It changes nothing; life_series_record records the readings.
import { indexModel, readingSeries } from './model-questions.mjs';

const STEPS = { month: 1 / 12, quarter: 1 / 4, year: 1 };
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
// Calendar time in the model's own unit: years, or days since 1970 as the Rust clock counts them.
function calendar(unit) {
  if (/^year/u.test(unit)) return { toYear: (value) => value, fromYear: (year) => year };
  if (/^civil_day_since_1970/u.test(unit)) return { toYear: (value) => 1970 + value / 365.2425, fromYear: (year) => (year - 1970) * 365.2425 };
  return null;
}
const round = (value) => Number(value.toFixed(6));
const label = (year, step) => {
  const whole = Math.floor(year + 1e-9);
  if (step === STEPS.quarter) return `${whole} ${QUARTERS[Math.min(3, Math.floor((year - whole) * 4 + 1e-6))]}`;
  if (step === STEPS.month) return `${whole}-${String(Math.min(12, Math.floor((year - whole) * 12 + 1e-6) + 1)).padStart(2, '0')}`;
  return String(whole);
};

export function seriesPlan(model, { subject, question = null, from, to, step = 'quarter' }) {
  const index = indexModel(model);
  const clock = calendar(String(model?.time_unit ?? ''));
  const size = typeof step === 'number' ? step : STEPS[step];
  if (!(size > 0)) throw new Error(`step must be month, quarter, year or a positive number of the model's time unit, not ${step}.`);
  if (!clock && typeof step !== 'number') throw new Error(`The model's time unit (${model?.time_unit ?? 'unstated'}) is not a calendar: give step as a number of its units.`);
  if (!(Number.isFinite(from) && Number.isFinite(to) && from < to)) throw new Error('from must come before to.');
  // Calendar inputs are years even when a numeric step counts native units. Lay out named steps in years and
  // numeric steps in native units, then return every slot in the model's unit.
  const numericStep = typeof step === 'number';
  const planFrom = clock && numericStep ? clock.fromYear(from) : from;
  const planTo = clock && numericStep ? clock.fromYear(to) : to;
  const native = (value) => (clock && !numericStep ? clock.fromYear(value) : value);
  const years = (value) => (clock ? clock.toYear(value) : value);
  const wanted = question?.trim().toLowerCase() ?? null;
  // A reading is the subject's when it sits in their life, or in their own perspective with them as its subject.
  const ownedBy = (item) => item.owner === subject || [item.event.participants?.subject].flat().includes(subject);
  const lists = [...readingSeries(index).values()].filter((list) => list.every(ownedBy) && (!wanted || String(list[0].cut.question ?? '').trim().toLowerCase() === wanted));
  if (!lists.length) throw new Error(`${subject} has no ${question ? `series asking "${question}"` : 'series'} to plan: record a first reading with life_series_record.`);
  return {
    schema: 'meaning-model-series-plan/v1', subject, step, from, to,
    series: lists.map((list) => {
      const [first] = list;
      const readings = list.map((item) => ({ cut: item.cut, start: item.event.interval.start, end: item.event.interval.end }))
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
      // Each slot boundary is a step boundary or an existing reading's edge, so every slot nests in the finest reading
      // around it; slots that existing finer readings already fill are left to them.
      const edges = new Set([round(native(planFrom)), round(native(planTo))]);
      for (let k = Math.ceil(planFrom / size - 1e-9); k * size <= planTo + 1e-9; k += 1) if (k * size >= planFrom - 1e-9) edges.add(round(native(k * size)));
      // Coarse readings cut the slots so each nests in one of them; a reading no longer than a step stays inside a slot.
      for (const item of readings) if (item.end - item.start > native(planFrom + size) - native(planFrom) + 1e-9) for (const edge of [item.start, item.end]) if (edge > native(planFrom) && edge < native(planTo)) edges.add(round(edge));
      const sorted = [...edges].sort((a, b) => a - b);
      const slots = [], keep = new Map();
      for (let i = 1; i < sorted.length; i += 1) {
        const [start, end] = [sorted[i - 1], sorted[i]];
        if (!(end - start > 1e-9)) continue;
        const around = readings.filter((item) => item.start <= start + 1e-9 && item.end >= end - 1e-9).sort((a, b) => (a.end - a.start) - (b.end - b.start));
        const finest = around[0] ?? null;
        if (finest && finest.end - finest.start <= end - start + 1e-9) continue; // already read at this resolution or finer
        slots.push({ start, end, label: label(years(start), size), within: finest?.cut.id ?? null });
        if (finest && !keep.has(finest.cut.id)) {
          keep.set(finest.cut.id, { cut: finest.cut.id, start: finest.start, end: finest.end,
            shares: Object.fromEntries((finest.cut.answers ?? []).map((answer) => [answer.key, answer.weight])), slots: 0 });
        }
        if (finest) keep.get(finest.cut.id).slots += 1;
      }
      return { question: first.cut.question, unit: first.cut.unit ?? null,
        answers: (first.cut.answers ?? []).map((answer) => ({ key: answer.key, ...(answer.meaning ? { meaning: answer.meaning } : {}) })),
        readings: readings.length, slots, keep: [...keep.values()] };
    }),
    rule: 'Each kept reading was a first guess. Weighted by duration, the readings you record inside it make up its average: where what you build shows the guess was wrong, revise it with a recorded reason rather than bending the detail to fit; where it was right, the detail keeps it. Record the slots with life_series_record under the subject\'s life, asking the same question in the same words, unit and answers so they join the same curve; give each reading a why (what happened in that stretch), a tag, and the Events that moved it as causes.',
  };
}
