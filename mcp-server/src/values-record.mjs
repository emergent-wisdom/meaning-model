// The working surface of numbers: dated values of scalar processes, recorded straight into the model.
//
// One call records values for many processes at once, and can open new processes under a parent as it goes, so
// populating a decomposition and deepening it are each one call. A value is a guess until something better replaces
// it: every value carries a tag (source, inferred, invented, exploring, sketch) and may carry a band, and recording
// the same time again replaces that value, while the model's revision history keeps the earlier one. Values live in
// the model (`value_series`), one series per process and holder; the understanding graph is left to the reasons.
//
// The result reports what to do next rather than refusing: processes that still have no values, and, where a
// parent declares how its children add up, the times at which they do not.

import { createHash } from 'node:crypto';
import { importanceRanks } from './importance-rank.mjs';
import { worldEvents } from './world-events.mjs';
import { coverageReport } from './coverage.mjs';

export const VALUE_TAGS = Object.freeze(['source', 'inferred', 'invented', 'exploring', 'sketch']);
const PROCESS_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const AGGREGATES = Object.freeze(['sum', 'mean']);

// A series is found by its process and holder, never by its id. A new id keeps the process readable and replaces the
// holder with a digest of the pair, so it is unambiguous (process ids cannot contain "~") and bounded however long or
// non-Latin the holder is. Ids made before this keep resolving, because lookup is by the pair.
const digest = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
const seriesIdOf = (processId, holder) => `values.${processId}~${digest([processId, holder])}`;

// Go-to state sets that serve many processes; a process may also define its own.
export const STATE_PRESETS = Object.freeze({
  phase: [['absent', 'Not there yet, or no longer traceable.'], ['emerging', 'Appearing, small and unsettled.'], ['growing', 'Spreading or strengthening.'],
    ['established', 'Settled and holding its own.'], ['declining', 'Shrinking or weakening.'], ['gone', 'Ended.']],
  intensity: [['none', 'Not happening.'], ['low', 'Present but slight.'], ['moderate', 'Clearly present.'], ['high', 'Dominant or severe.'], ['extreme', 'At its worst or fullest.']],
  direction: [['falling', 'Going down.'], ['stable', 'Holding level.'], ['rising', 'Going up.']],
  presence: [['absent', 'Not present.'], ['present', 'Present.']],
});
const statesOf = (spec) => (spec.states ?? STATE_PRESETS[spec.preset] ?? null);

// A world started from the model begins from each process's initial value. A process opened here takes the value
// recorded nearest time zero, and its support says which one, so the copy is never silent.
const seededFrom = (near) => `initial value copied from the value recorded at ${near.time} (${near.tag}), the date nearest time 0`;

// The process a new node becomes: a scalar with wide bounds, its first value near time zero as its initial value.
function newProcess(entry, holder) {
  const { processId, process: spec, points } = entry;
  const states = statesOf(spec);
  if (states) {
    const near = [...points].sort((a, b) => Math.abs(a.time) - Math.abs(b.time))[0];
    return { id: processId, value_type: { kind: 'category', variants: states.map(([key]) => key) }, initial_value: { kind: 'category', value: near.state },
      uncertainty: { kind: 'unknown' }, provenance: [`${near.tag}: opened by life_values_record for ${holder}`], axes: [], unit: null, reference_frame: spec.frame ?? null,
      scale: { semantic_role: `${spec.label}: ${spec.meaning ?? `one of ${states.length} states`}`, label: spec.label, ...(spec.preset ? { states: spec.preset } : {}),
        ...(spec.subject ? { subject_referent_id: spec.subject } : {}),
        ...Object.fromEntries(states.map(([key, meaning]) => [`state:${key}`, meaning])) },
      support: ['dated states in value_series', seededFrom(near)], access_scopes: [], update_mode: 'observed' };
  }
  if (spec.scale) {
    const { minimum, maximum, anchors } = spec.scale;
    if (!(minimum < maximum)) throw new Error(`${processId}: a scale needs minimum below maximum.`);
    if (anchors.some(([at]) => at < minimum || at > maximum)) throw new Error(`${processId}: scale anchors must lie within the scale.`);
    const near = [...points].sort((a, b) => Math.abs(a.time) - Math.abs(b.time))[0];
    const unit = `on a scale of ${minimum} to ${maximum}`;
    return { id: processId, value_type: { kind: 'scalar', bounds: { minimum, maximum } }, initial_value: { kind: 'scalar', value: near.value },
      uncertainty: near.lower !== undefined && near.upper !== undefined ? { kind: 'interval', lower: near.lower, upper: near.upper } : { kind: 'unknown' },
      provenance: [`${near.tag}: opened by life_values_record for ${holder}`], axes: [], unit, reference_frame: spec.frame ?? null,
      scale: { semantic_role: `${spec.label}: ${spec.meaning ?? 'a defined scale'}`, label: spec.label, kind: 'defined-scale', ...(spec.subject ? { subject_referent_id: spec.subject } : {}),
        ...Object.fromEntries(anchors.map(([at, meaning]) => [`anchor:${at}`, meaning])), ...(spec.aggregate ? { aggregate: spec.aggregate } : {}) },
      support: ['dated values on a defined scale in value_series', seededFrom(near)], access_scopes: [], update_mode: 'observed' };
  }
  if (!spec.unit) throw new Error(`${processId}: give a unit for an empirical value, a scale with anchors, or states or a preset for a set of states.`);
  if (points.some((p) => p.value === undefined)) throw new Error(`${processId} is a number; every point needs a value.`);
  const values = points.flatMap((p) => [p.value, p.lower ?? p.value, p.upper ?? p.value]);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = Math.max(hi - lo, Math.abs(hi), Math.abs(lo), 1);
  const bounds = spec.bounds ?? { minimum: lo >= 0 ? 0 : lo - 10 * span, maximum: hi + 10 * span };
  const near = [...points].sort((a, b) => Math.abs(a.time) - Math.abs(b.time))[0];
  return {
    id: processId,
    value_type: { kind: 'scalar', bounds },
    initial_value: { kind: 'scalar', value: near.value },
    uncertainty: near.lower !== undefined && near.upper !== undefined ? { kind: 'interval', lower: near.lower, upper: near.upper } : { kind: 'unknown' },
    provenance: [`${near.tag}: opened by life_values_record for ${holder}`],
    axes: [],
    unit: spec.unit,
    reference_frame: spec.frame ?? null,
    scale: { semantic_role: `${spec.label}: ${spec.meaning ?? spec.unit}`, label: spec.label, ...(spec.aggregate ? { aggregate: spec.aggregate } : {}),
      ...(spec.subject ? { subject_referent_id: spec.subject } : {}) },
    support: ['dated values in value_series', seededFrom(near)],
    access_scopes: [],
    update_mode: 'observed',
  };
}

export function valuesChange(previous, input) {
  const processes = new Map((previous.processes ?? []).map((p) => [p.id, p]));
  const series = new Map((previous.value_series ?? []).map((s) => [s.id, s]));
  const holder = input.holder;
  const upsert = { value_series: [] };
  const added = [];
  // The tree so far, with the edges this call adds, so a process can be filed under a parent opened earlier in the call.
  const edges = [...(previous.decomposition ?? [])];
  const parentOf = (id) => edges.find((edge) => edge.child === id)?.parent ?? null;
  const fileUnder = (processId, spec) => {
    if (!processes.has(spec.parent)) throw new Error(`${processId}: parent ${spec.parent} is not a process.`);
    for (let at = spec.parent, steps = 0; at && steps < 10_000; at = parentOf(at), steps += 1) {
      if (at === processId) throw new Error(`${processId} cannot be filed under ${spec.parent}, which is part of it.`);
    }
    let id = `d.${processId}`;
    for (let n = 2; edges.some((edge) => edge.id === id); n += 1) id = `d.${processId}.${n}`;
    const edge = { id, parent: spec.parent, child: processId, kind: spec.edge ?? 'functional_refinement' };
    edges.push(edge);
    (upsert.decomposition ??= []).push(edge);
  };
  const referents = new Set((previous.meaning_model?.referents ?? []).map((referent) => referent.id));
  // A process about one Thing names it, and is then held only to that Thing's life in the time schedule.
  const checkSubject = (processId, subject) => { if (subject && !referents.has(subject)) throw new Error(`${processId}: ${subject} is not a referent of the model; register the Thing first, or leave subject out.`); };
  for (const entry of input.values) {
    if (!PROCESS_ID.test(entry.processId)) throw new Error(`${entry.processId} is not a usable process id.`);
    if (entry.reason && Buffer.byteLength(entry.reason, 'utf8') > 4_000) throw new Error(`${entry.processId}: the reason is ${Buffer.byteLength(entry.reason, 'utf8')} bytes; keep it under 4,000 bytes.`);
    const points = entry.points ?? [];
    const times = points.map((p) => p.time);
    if (new Set(times).size !== times.length) throw new Error(`${entry.processId}: two values at the same time in one call.`);
    for (const p of points) {
      if ((p.lower === undefined) !== (p.upper === undefined)) throw new Error(`${entry.processId} at ${p.time}: give a band as both lower and upper, or leave both out.`);
      if ((p.lower !== undefined && p.lower > p.value) || (p.upper !== undefined && p.upper < p.value)) throw new Error(`${entry.processId} at ${p.time}: lower and upper must surround the value.`);
    }
    if (!processes.has(entry.processId)) {
      if (!entry.process?.label) throw new Error(`${entry.processId} is not a process of the model; give process {label, unit, parent?} to open it.`);
      if (!points.length) throw new Error(`${entry.processId}: a new process needs at least one value; guess one with an honest band.`);
      checkSubject(entry.processId, entry.process.subject);
      const process = newProcess({ ...entry, points }, holder);
      (upsert.processes ??= []).push(process);
      added.push(process);
      processes.set(process.id, process);
      if (entry.process.parent) fileUnder(entry.processId, entry.process);
    } else {
      if (entry.process?.parent) {
        // A process opened before its parent existed is filed under it here; moving one already filed is a revision.
        const current = parentOf(entry.processId);
        if (current && current !== entry.process.parent) throw new Error(`${entry.processId} is already part of ${current}; change its decomposition edge with life_model_revise to move it.`);
        if (!current) fileUnder(entry.processId, entry.process);
      }
      if (entry.process?.subject) {
        checkSubject(entry.processId, entry.process.subject);
        const existing = processes.get(entry.processId), current = existing.scale?.subject_referent_id;
        if (current && current !== entry.process.subject) throw new Error(`${entry.processId} is already about ${current}; change its scale with life_model_revise to move it.`);
        if (!current) {
          const updated = { ...structuredClone(existing), scale: { ...(existing.scale ?? {}), subject_referent_id: entry.process.subject } };
          upsert.processes = [...(upsert.processes ?? []).filter((item) => item.id !== updated.id), updated];
          processes.set(updated.id, updated);
        }
      }
    }
    if (!points.length) {
      if (!entry.process?.parent && !entry.process?.subject) throw new Error(`${entry.processId}: give points to record, or process {parent} or {subject} to file it.`);
      continue;
    }
    const target = processes.get(entry.processId);
    const kind = target.value_type?.kind;
    if (kind === 'scalar') {
      if (!String(target.unit ?? '').trim()) throw new Error(`${entry.processId} has no unit: a number needs a unit or a declared scale before it can be recorded.`);
      if (points.some((p) => p.value === undefined || p.state !== undefined)) throw new Error(`${entry.processId} is a number: give each point a value, not a state.`);
    } else if (kind === 'category' || kind === 'regime') {
      const allowed = target.value_type.variants;
      for (const p of points) {
        if (p.state === undefined || p.value !== undefined || p.lower !== undefined || p.upper !== undefined) throw new Error(`${entry.processId} has defined states: give each point a state, not a number.`);
        if (!allowed.includes(p.state)) throw new Error(`${entry.processId} at ${p.time}: ${p.state} is not one of its states (${allowed.join(', ')}).`);
      }
    } else throw new Error(`${entry.processId} is a ${kind} process; record numbers or defined states, a Cut with life_series_record, or a law with life_model_revise.`);
    const existing = [...series.values()].find((s) => s.process_id === entry.processId && s.holder === holder);
    const id = existing?.id ?? seriesIdOf(entry.processId, holder);
    const clash = series.get(id);
    if (!existing && clash) throw new Error(`Series id ${id} already belongs to ${clash.process_id} held by ${clash.holder}.`);
    const merged = new Map((existing?.points ?? []).map((p) => [p.time, p]));
    for (const p of points) merged.set(p.time, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    const record = { id, process_id: entry.processId, holder, points: [...merged.values()].sort((a, b) => a.time - b.time),
      ...(entry.reason ?? existing?.reason ? { reason: entry.reason ?? existing.reason } : {}), provenance: ['life_values_record'] };
    upsert.value_series.push(record);
    series.set(id, record);
  }
  return { reason: input.reason, provenance: ['life_values_record'], upsert };
}

// The time schedule and the coverage report are shared with the series of Cuts (coverage.mjs).
export { SCHEDULE_BLOCKS, timeSchedule } from './coverage.mjs';

// What the surface still lacks and where it contradicts itself. Never a refusal.
export function valuesReport(model, options = {}) {
  return valuesAccount(model, options).report;
}

// The report, with the lines that keep this pass from being done and the coverage report they were judged with.
function valuesAccount(model, { holder = null, focus = [] } = {}) {
  // Each holder's own values, process by process and time by time.
  const byHolder = new Map();
  for (const s of model.value_series ?? []) {
    const own = byHolder.get(s.holder) ?? new Map();
    const m = own.get(s.process_id) ?? new Map();
    for (const p of s.points) m.set(p.time, p);
    own.set(s.process_id, m);
    byHolder.set(s.holder, own);
  }
  // What the caller is shown about recording (what new values show, single dates, coarse stretches): one holder's
  // values when a holder is given, else every holder's.
  const valued = new Map();
  for (const [who, own] of byHolder) {
    if (holder && who !== holder) continue;
    for (const [id, m] of own) { const all = valued.get(id) ?? new Map(); for (const [t, point] of m) all.set(t, point); valued.set(id, all); }
  }
  // Whether this pass is done is judged on the model's one account, as the coverage report judges it: a process any
  // holder has valued is not empty, and its dates are every holder's dates.
  const accountTimes = new Map();
  for (const own of byHolder.values()) for (const [id, m] of own) { const times = accountTimes.get(id) ?? new Set(); for (const t of m.keys()) times.add(t); accountTimes.set(id, times); }
  const scalars = (model.processes ?? []).filter((p) => p.value_type?.kind === 'scalar');
  const stated = (model.processes ?? []).filter((p) => ['scalar', 'category', 'regime'].includes(p.value_type?.kind));
  // A process a law computes from others has its state through the law, and one with dated claims through its
  // accounts, not through recorded points.
  const computed = new Set((model.dependencies ?? []).filter((d) => d.law_id).map((d) => d.target));
  const claimed = new Set((model.initial_claims ?? []).map((c) => c.subject));
  const stillEmpty = stated.filter((p) => !accountTimes.has(p.id) && !computed.has(p.id) && !claimed.has(p.id)).map((p) => p.id);
  const children = new Map();
  for (const edge of model.decomposition ?? []) children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
  const contradictions = [], residuals = [], notCompared = [];
  const byId = new Map((model.processes ?? []).map((p) => [p.id, p]));
  const sums = [];
  for (const parent of scalars) {
    const how = parent.scale?.aggregate;
    if (!AGGREGATES.includes(how)) continue;
    // Only parts in the parent's own unit are added up; the others are named, not compared.
    const all = children.get(parent.id) ?? [];
    const kids = all.filter((id) => byId.get(id)?.value_type?.kind === 'scalar' && String(byId.get(id)?.unit ?? '') === String(parent.unit ?? ''));
    for (const id of all.filter((x) => !kids.includes(x))) notCompared.push({ process: parent.id, child: id, why: byId.get(id)?.value_type?.kind !== 'scalar' ? 'not a number' : `unit ${byId.get(id)?.unit ?? 'none'} is not ${parent.unit ?? 'none'}` });
    if (kids.length) sums.push({ parent, how, kids });
  }
  // A holder's whole is compared only with that holder's parts: two holders' accounts that differ are a disagreement
  // between accounts, not a contradiction within one.
  for (const [who, own] of byHolder) {
    for (const { parent, how, kids } of sums) {
      for (const [time, p] of own.get(parent.id) ?? []) {
        // Compared only at times every part has a value.
        const parts = kids.map((id) => own.get(id)?.get(time)).filter(Boolean);
        if (parts.length !== kids.length) continue;
        // A sum's parts may fall short of it (the residual not yet opened) but not exceed it; a mean must agree.
        const total = parts.reduce((s, x) => s + x.value, 0);
        const expected = how === 'sum' ? total : total / parts.length;
        const tolerance = Math.max((p.upper ?? p.value) - (p.lower ?? p.value), Math.abs(p.value) * 0.01, 1e-9);
        const over = how === 'sum' ? expected - p.value > tolerance : Math.abs(expected - p.value) > tolerance;
        if (over) contradictions.push({ process: parent.id, holder: who, time, value: p.value, [how]: Number(expected.toPrecision(6)), children: kids });
        else if (how === 'sum' && p.value - expected > tolerance) residuals.push({ process: parent.id, holder: who, time, unopened: Number((p.value - expected).toPrecision(6)) });
      }
    }
  }
  const points = [...valued.values()].reduce((n, m) => n + m.size, 0);

  // Where to go next, down the two trees. The tree of processes: processes never divided, highest first, so the world
  // opens from the top. The tree of time: the coarsest stretches, a gap between two dates measured against how far it
  // lies from the latest date (log time, with the model's median gap as its unit), and first of all a stretch where other
  // processes already hold dates inside it, so the world is filled where it is thinnest compared with itself.
  const parentOf = new Map((model.decomposition ?? []).map((edge) => [edge.child, edge.parent]));
  const depth = (id) => { let d = 0; for (let at = id; parentOf.has(at) && d < 64; at = parentOf.get(at)) d += 1; return d; };
  const label = (id) => byId.get(id)?.scale?.label ?? id;
  const undivided = stated.filter((p) => !(children.get(p.id) ?? []).length && valued.has(p.id))
    .map((p) => ({ process: p.id, label: label(p.id), depth: depth(p.id) })).sort((a, b) => a.depth - b.depth || a.process.localeCompare(b.process));
  const allTimes = [...new Set([...valued.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  const latest = allTimes.at(-1) ?? 0;
  const spans = [];
  for (const [id, m] of valued) { const t = [...m.keys()].sort((a, b) => a - b); for (let i = 1; i < t.length; i++) spans.push([id, t[i - 1], t[i]]); }
  const sortedGaps = spans.map(([, a, b]) => b - a).sort((a, b) => a - b);
  const unit = Math.max(sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 1, 1e-9);
  const inside = (a, b) => { let n = 0; for (const t of allTimes) if (t > a && t < b) n += 1; return n; };
  const gaps = spans.map(([id, from, to]) => ({ process: id, label: label(id), from, to, finerElsewhere: inside(from, to),
    coarseness: Number(Math.log((latest - from + unit) / (latest - to + unit)).toPrecision(3)) }));
  const coarsest = gaps.sort((a, b) => b.finerElsewhere - a.finerElsewhere || b.coarseness - a.coarseness).slice(0, 10);
  // The model's own Events say where things happen. A process with no value across a stretch in which several of them
  // happen says nothing about what they changed: the stretches passing over the most Events, one per process.
  // Examples name the Events ranked most important first, then the shortest, so a long era does not stand for its parts.
  const rankOf = importanceRanks(model.meaning_model);
  const happenings = worldEvents(model.meaning_model).filter((event) => Number.isFinite(event.interval?.start))
    .map((event) => ({ t: event.interval.start, rank: rankOf.get(event.id) ?? Infinity, span: (event.interval.end ?? event.interval.start) - event.interval.start,
      name: String(event.boundary ?? event.id).replace(/\s+/gu, ' ').slice(0, 48) }))
    .sort((a, b) => a.rank - b.rank || a.span - b.span);
  // How many happen strictly inside (a, b): two binary searches over the sorted times.
  const happeningTimes = happenings.map((event) => event.t).sort((a, b) => a - b);
  const firstAbove = (x) => { let lo = 0, hi = happeningTimes.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (happeningTimes[mid] <= x) lo = mid + 1; else hi = mid; } return lo; };
  const firstAtOrAbove = (x) => { let lo = 0, hi = happeningTimes.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (happeningTimes[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
  const between = (a, b) => Math.max(0, firstAtOrAbove(b) - firstAbove(a));
  const passedOver = [];
  for (const [id, times] of accountTimes) {
    const t = [...times].sort((a, b) => a - b); let widest = null;
    for (let i = 1; i < t.length; i += 1) {
      const count = between(t[i - 1], t[i]);
      if (count >= 3 && (!widest || count > widest.events)) widest = { process: id, label: label(id), from: t[i - 1], to: t[i], events: count };
    }
    if (widest) passedOver.push({ ...widest, examples: happenings.filter((event) => event.t > widest.from && event.t < widest.to).slice(0, 3).map((event) => event.name) });
  }
  passedOver.sort((a, b) => b.events - a.events || a.process.localeCompare(b.process));
  // What the values just recorded show: where a curve peaks or bottoms out, and where it changes most, measured against
  // its own range. Guesses taken together show what no single one could, and a shape nobody expected is a question.
  const shows = [];
  for (const id of new Set(focus)) {
    const points = [...(valued.get(id)?.values() ?? [])].filter((p) => Number.isFinite(p.value)).sort((a, b) => a.time - b.time);
    if (points.length < 3 || byId.get(id)?.value_type?.kind !== 'scalar') continue;
    const values = points.map((p) => p.value), range = Math.max(...values) - Math.min(...values);
    if (!(range > 0)) continue;
    let steepest = null;
    for (let i = 1; i < points.length; i += 1) {
      const rise = points[i].value - points[i - 1].value;
      if (!steepest || Math.abs(rise) > Math.abs(steepest.rise)) steepest = { rise, from: points[i - 1], to: points[i] };
      if (i < points.length - 1) {
        const after = points[i + 1].value - points[i].value, turn = Math.min(Math.abs(rise), Math.abs(after)) / range;
        if (rise * after < 0 && turn >= 0.1) shows.push({ process: id, label: label(id), kind: rise > 0 ? 'peak' : 'trough', at: points[i].time, value: points[i].value, weight: turn });
      }
    }
    if (steepest) shows.push({ process: id, label: label(id), kind: steepest.rise > 0 ? 'rise' : 'fall', from: steepest.from.time, to: steepest.to.time,
      fromValue: steepest.from.value, toValue: steepest.to.value, weight: Math.abs(steepest.rise) / range });
  }
  shows.sort((a, b) => b.weight - a.weight);
  const describe = (item) => (item.kind === 'peak' || item.kind === 'trough'
    ? `${item.label} ${item.kind === 'peak' ? 'peaks' : 'bottoms out'} at ${item.at} (${item.value}) and turns`
    : `${item.label} ${item.kind === 'rise' ? 'rises' : 'falls'} most between ${item.from} and ${item.to} (${item.fromValue} to ${item.toValue})`);
  // A process with one date has a value but no line over time, and the viewer draws it only from its second date.
  const oneDate = [...valued].filter(([, m]) => m.size === 1).map(([id]) => id);
  // A world opens from one top. Many processes with nothing above them are a list, not a tree.
  const roots = stated.filter((p) => !parentOf.has(p.id)).map((p) => p.id);
  // Coverage in time, and done, are judged with the series of Cuts in one report.
  const coverage = coverageReport(model, { stillEmpty, passedOver, contradictions });
  const { done } = coverage;
  // What keeps this pass from being done besides the time schedule: contradictions, empty processes, passed-over Events.
  const resolveLine = contradictions.length ? `Resolve ${contradictions.length} contradiction(s) first: parts that exceed the sum they belong to, beginning with ${label(contradictions[0].process)} at ${contradictions[0].time}${byHolder.size > 1 ? ` in the values held by ${contradictions[0].holder}` : ''}.` : null;
  const emptyLine = stillEmpty.length ? `Guess the state of ${stillEmpty.length} process(es) that have none, beginning with ${stillEmpty.slice(0, 3).map(label).join(', ')}.` : null;
  const passedLine = passedOver.length ? `${passedOver.length} process(es) pass over your own Events without a value, so they say nothing about what those Events changed: ${passedOver.slice(0, 3).map((g) => `${g.label} has none between ${g.from} and ${g.to}, where ${g.events} Events happen (${g.examples.join('; ')})`).join('. ')}. Give each process a value at the Events that change it, and between them where the record allows.` : null;
  const next = [coverage.status];
  if (shows.length) next.push(`What your new values show: ${shows.slice(0, 3).map(describe).join('; ')}. Ask why each happens, check it against your Events and the patterns you expect, record what you learn as a note, and let it choose where to guess next: each guess you add is another test of the rest.`);
  if (resolveLine) next.push(resolveLine);
  if (emptyLine) next.push(emptyLine);
  if (roots.length > 3) next.push(`${roots.length} processes have nothing above them, among them ${roots.slice(0, 5).map(label).join(', ')}. Open the whole they are parts of as one process with a measure of its own, open the dimensions of your carve under it, and file each of these under the dimension it belongs to (process {parent} in life_values_record).`);
  if (undivided.length) next.push(`Open the processes never divided, highest first: ${undivided.slice(0, 5).map((u) => u.label).join(', ')}. Ask what must change for each to change, open its parts and guess their states at once.`);
  if (oneDate.length) next.push(`Give a second date to ${oneDate.length} process(es) that have only one, so each shows as a line over time: ${oneDate.slice(0, 5).map(label).join(', ')}.`);
  next.push(...coverage.next.slice(1));
  if (passedLine) next.push(passedLine);
  if (coarsest.length && !coverage.schedule?.next) next.push(`Open the coarsest stretches with dates inside them: ${coarsest.slice(0, 5).map((g) => `${g.label} ${g.from} to ${g.to}`).join('; ')}.`);
  const report = { done, processes: stated.length, valued: valued.size, points, stillEmpty: stillEmpty.slice(0, 50), stillEmptyCount: stillEmpty.length,
    contradictions: contradictions.slice(0, 50), contradictionCount: contradictions.length, residualCount: residuals.length, residuals: residuals.slice(0, 20),
    ...(notCompared.length ? { notCompared: notCompared.slice(0, 20) } : {}),
    ...(coverage.schedule ? { schedule: coverage.schedule } : {}), coverage: { tracks: coverage.tracks, holders: coverage.holders, flatCount: coverage.flatCount, steadyCount: coverage.steadyCount, ...(coverage.flat ? { flat: coverage.flat } : {}) },
    ...(shows.length ? { shows: shows.slice(0, 10).map(({ weight, ...item }) => item) } : {}),
    ...(passedOver.length ? { passedOver: passedOver.slice(0, 20), passedOverCount: passedOver.length } : {}), roots: roots.slice(0, 20), rootCount: roots.length, undivided: undivided.slice(0, 20), undividedCount: undivided.length, ...(oneDate.length ? { oneDate: oneDate.slice(0, 50), oneDateCount: oneDate.length } : {}), coarsest, next };
  return { report, coverage, blocking: [resolveLine, emptyLine, passedLine].filter(Boolean) };
}

// The coverage part of the report alone, for the series tool and the model's questions: whether this pass is done, how
// far the time schedule is filled, and every line that keeps it from being done, so done:false always says why.
export function coverageSummary(model) {
  const { report, coverage, blocking } = valuesAccount(model);
  return { done: report.done, ...(report.schedule ? { schedule: report.schedule } : {}), tracks: coverage.tracks, holders: coverage.holders, flatCount: coverage.flatCount, steadyCount: coverage.steadyCount,
    ...(coverage.flat ? { flat: coverage.flat } : {}), ...(report.stillEmptyCount ? { stillEmptyCount: report.stillEmptyCount } : {}),
    ...(report.passedOverCount ? { passedOverCount: report.passedOverCount } : {}), ...(report.contradictionCount ? { contradictionCount: report.contradictionCount } : {}),
    next: [coverage.status, ...blocking, ...coverage.next.slice(1)] };
}
