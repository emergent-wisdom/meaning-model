import { SERIES_EVENT_MARK, STEADY_MARK } from './series-mark.mjs';
import { projectNumerics } from './viewer-numerics.mjs';
import { cutTrajectories } from '../viewer/public/cut-trajectories.js';

// A series of readings in one call: one question, asked of one subject at many dated intervals, each reading with its
// reason. The series becomes an ordinary model change (a dated Event per reading inside the subject's life, its Cut,
// and the links that place it), so it passes the same validation, remainder default and immutable revision as any
// other change. A series can also open one answer of another series into its own exclusive categories: its readings
// then divide that answer's share on the same Events, as conditional Cuts.
//
// Ids follow the series and the interval, not the position in the call, so recording an interval again replaces that
// reading and adding readings never renames the others. What the viewer could not draw as one series is refused here
// rather than silently dropped later: a reworded question under the same series id, readings that partly overlap,
// and an opened category without a reading of the same interval to divide.

export const SERIES_TAGS = Object.freeze(['source', 'inferred', 'invented', 'exploring', 'sketch']);
const REMAINDER = 'remainder';
const SUM_TOLERANCE = 1e-6;
const SERIES_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const KEY = /^[a-z][a-z0-9_]{0,63}$/u;

const stamp = (value) => String(Number(value.toFixed(6))).replace('-', 'm');
const intervalId = ({ start, end }) => `${stamp(start)}-${stamp(end)}`;
export const seriesEventId = (seriesId, reading) => `event.series.${seriesId}.${intervalId(reading)}`;
export const seriesCutId = (seriesId, reading) => `cut.series.${seriesId}.${intervalId(reading)}`;
const seriesOfCut = (cut) => /^cut\.series\.([a-z0-9_-]+)\./u.exec(cut.id ?? '')?.[1] ?? null;
const keysOf = (cut) => (cut.answers ?? []).map((answer) => answer.key).filter((key) => key !== REMAINDER).sort();
const sameKeys = (a, b) => a.length === b.length && a.every((key, i) => key === b[i]);
const partlyOverlap = (a, b) => (a.start < b.start && b.start < a.end && a.end < b.end) || (b.start < a.start && a.start < b.end && b.end < a.end);

export function seriesChange(previous, input) {
  const mm = previous?.meaning_model;
  if (!mm) throw new Error('The model has no meaning_model to record a series in.');
  const { series, readings, subject } = input;
  if (!SERIES_ID.test(series.id)) throw new Error(`series.id ${series.id} must be lowercase letters, digits, - or _, starting with a letter or digit.`);
  const keys = series.answers.map((answer) => answer.key);
  if (keys.some((key) => !KEY.test(key) || key === REMAINDER)) throw new Error('Answer keys are lowercase identifiers; name a remainder with series.remainder, not as an answer.');
  if (new Set(keys).size !== keys.length) throw new Error('Answer keys must be distinct.');
  if (!series.conditionedOn && keys.length < 2) throw new Error('A series divides one unit among at least two exclusive answers.');
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const cuts = mm.normalized_cuts ?? [];
  const referent = (mm.referents ?? []).find((item) => item.id === subject);
  if (!referent) throw new Error(`No referent ${subject} in the model; register the subject first.`);
  const parentEventId = input.parentEventId ?? referent.lifecycle_event_id;
  if (!parentEventId || !events.has(parentEventId)) throw new Error(`The readings need a parent Event inside ${subject}'s life: pass parentEventId, or give ${subject} a lifecycle Event.`);
  const parentInterval = events.get(parentEventId).interval;

  // A series id keeps one question in one wording, with one unit and one set of answers, about one subject.
  const sortedKeys = [...keys].sort();
  const existing = cuts.filter((cut) => seriesOfCut(cut) === series.id);
  const subjectOf = (cut) => [events.get(cut.parent_event_id)?.participants?.subject].flat().find((id) => typeof id === 'string') ?? null;
  const other = existing.map(subjectOf).find((id) => id && id !== subject);
  if (other) throw new Error(`Series ${series.id} already follows ${other}. Give ${subject}'s readings their own series id: a series id holds one question about one subject, and reusing it would replace ${other}'s readings.`);
  const mismatch = existing.find((cut) => cut.question !== series.question || cut.unit !== series.unit || !sameKeys(keysOf(cut), sortedKeys));
  if (mismatch) {
    throw new Error(`Series ${series.id} already asks "${mismatch.question}" in unit "${mismatch.unit}" with answers ${keysOf(mismatch).join(', ')}. `
      + 'Use the same wording, unit and answers, or a new series id: a reworded question would start a separate series that cannot be compared or averaged with this one.');
  }

  // An opened category divides one answer of another series, reading by reading, on the same Events.
  let enclosing = null;
  if (series.conditionedOn) {
    const parentCuts = cuts.filter((cut) => seriesOfCut(cut) === series.conditionedOn.seriesId);
    if (!parentCuts.length) throw new Error(`No series ${series.conditionedOn.seriesId} to open; record it first.`);
    if (!(parentCuts[0].answers ?? []).some((answer) => answer.key === series.conditionedOn.answerKey)) {
      throw new Error(`Series ${series.conditionedOn.seriesId} has no answer ${series.conditionedOn.answerKey}.`);
    }
    const parentSubject = parentCuts.map(subjectOf).find(Boolean);
    if (parentSubject && parentSubject !== subject) throw new Error(`Series ${series.conditionedOn.seriesId} follows ${parentSubject}, not ${subject}; an opened category divides a series about the same subject.`);
    enclosing = new Map(parentCuts.map((cut) => [intervalId(events.get(cut.parent_event_id)?.interval ?? { start: NaN, end: NaN }), cut]));
  }

  const allowed = new Set([...keys, ...(series.remainder ? [REMAINDER] : [])]);
  const intervals = existing.map((cut) => events.get(cut.parent_event_id)?.interval).filter(Boolean);
  const upsertEvents = []; const upsertRelations = []; const upsertCuts = []; const removeRelations = []; const seen = new Set();
  const relationIds = new Set((mm.event_relations ?? []).map((relation) => relation.id));
  for (const reading of readings) {
    const { start, end } = reading;
    const label = `${series.id} ${stamp(start)} to ${stamp(end)}`;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error(`Reading ${label} needs a finite start no later than its end.`);
    if (!SERIES_TAGS.includes(reading.tag)) throw new Error(`Reading ${label} needs a tag: one of ${SERIES_TAGS.join(', ')}.`);
    if (!reading.why?.trim()) throw new Error(`Reading ${label} needs a why: what happens in this stretch that gives these shares.`);
    const id = intervalId(reading);
    if (seen.has(id)) throw new Error(`Two readings in this call share the interval ${stamp(start)} to ${stamp(end)}.`);
    seen.add(id);
    const unknown = Object.keys(reading.weights).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`Reading ${label} weighs ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is not an answer' : 'are not answers'} of this series${unknown.includes(REMAINDER) ? '; declare series.remainder to name a remainder' : ''}.`);
    const total = Object.values(reading.weights).reduce((sum, weight) => sum + weight, 0);
    if (Object.values(reading.weights).some((weight) => !Number.isFinite(weight) || weight < 0) || Math.abs(total - 1) > SUM_TOLERANCE) {
      throw new Error(`Reading ${label}: the shares must be nonnegative and sum to 1; they sum to ${Number(total.toPrecision(12))}.`);
    }
    // How sure the reading is, when the agent says: a first estimate low, raised as the interval is recorded again.
    const provenance = [`${reading.tag}: ${reading.why.trim()}`, ...(reading.confidence === undefined ? [] : [`confidence ${Number(reading.confidence.toFixed(3))}`])];
    const answers = [...keys.map((key) => ({ key, weight: reading.weights[key] ?? 0, meaning: series.answers.find((answer) => answer.key === key).meaning })),
      ...(series.remainder ? [{ key: REMAINDER, weight: reading.weights[REMAINDER] ?? 0, meaning: series.remainder.meaning }] : [])];
    if (enclosing) {
      const parentCut = enclosing.get(id);
      if (!parentCut) throw new Error(`Reading ${label} opens ${series.conditionedOn.seriesId}, which has no reading of exactly that interval to divide.`);
      upsertCuts.push({ id: seriesCutId(series.id, reading), parent_event_id: parentCut.parent_event_id, question: series.question, unit: series.unit, answers,
        provenance, conditioning: { cut_id: parentCut.id, answer_key: series.conditionedOn.answerKey } });
      continue;
    }
    if (parentInterval && (start < parentInterval.start || end > parentInterval.end)) {
      throw new Error(`Reading ${label} lies outside its parent Event ${parentEventId} (${parentInterval.start} to ${parentInterval.end}).`);
    }
    const clash = [...intervals, ...readings.filter((other) => other !== reading)].find((other) => partlyOverlap(other, reading));
    if (clash) throw new Error(`Reading ${label} partly overlaps the reading ${stamp(clash.start)} to ${stamp(clash.end)}; nest one inside the other or make them disjoint.`);
    const eventId = seriesEventId(series.id, reading);
    upsertEvents.push({ id: eventId, boundary: reading.label?.trim() || label, description: reading.why.trim(), interval: { start, end },
      participants: { subject }, process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance: [...provenance, SERIES_EVENT_MARK, ...(reading.steady ? [STEADY_MARK] : [])] });
    upsertRelations.push({ id: `relation.series.${series.id}.${id}`, kind: 'contains', source_event_id: parentEventId, target_event_id: eventId,
      description: null, authority: null, uncertainty: { kind: 'unknown' }, provenance });
    // Recording an interval again replaces the whole reading, its causes included: links it no longer names go.
    const causePrefix = `relation.series.${series.id}.${id}.cause.`;
    const causeIds = new Set((reading.causes ?? []).map((cause) => `${causePrefix}${cause}`));
    for (const relationId of relationIds) if (relationId.startsWith(causePrefix) && !causeIds.has(relationId)) removeRelations.push(relationId);
    for (const cause of reading.causes ?? []) {
      if (!events.has(cause)) throw new Error(`Reading ${label} names cause ${cause}, which is not an Event in the model.`);
      upsertRelations.push({ id: `${causePrefix}${cause}`, kind: 'causes', source_event_id: cause, target_event_id: eventId,
        description: `Moves "${series.question}" in this stretch.`, authority: null, uncertainty: { kind: 'unknown' }, provenance });
    }
    upsertCuts.push({ id: seriesCutId(series.id, reading), parent_event_id: eventId, question: series.question, unit: series.unit, answers, provenance });
  }
  const upsert = { normalized_cuts: upsertCuts };
  if (upsertEvents.length) upsert.events = upsertEvents;
  if (upsertRelations.length) upsert.event_relations = upsertRelations;
  return { reason: input.reason, provenance: ['life_series_record'], upsert, ...(removeRelations.length ? { remove: { event_relations: removeRelations } } : {}) };
}

// How a recorded series will draw in the viewer: how many of its readings join a curve, and if none do, why. This is
// the read-back an agent would otherwise have to do by opening the viewer.

export function seriesDrawing(model, seriesId) {
  const prefix = `cut.series.${seriesId}.`;
  const numerics = projectNumerics(model);
  const records = (numerics.cuts ?? []).filter((cut) => cut.id.startsWith(prefix));
  const drawn = new Set(cutTrajectories({ inspection: { model }, numerics }).flatMap((row) => row.points.map((point) => point.cutId)).filter((id) => id.startsWith(prefix)));
  const why = drawn.size ? null
    : records.length < 2 ? 'A curve needs at least two readings of the series.'
      : records.some((cut) => cut.contextStatus !== 'declared') ? 'The readings sit under no declared context root: give the model an accepted-world root (context_roots) that contains the subject\'s life.'
        : 'The readings\' owner or perspective could not be resolved to one subject; check that they sit inside one life and one context.';
  return { readings: records.length, drawnAsCurve: drawn.size, ...(why ? { notDrawn: why } : {}) };
}
