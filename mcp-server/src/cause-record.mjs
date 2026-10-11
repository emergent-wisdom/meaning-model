// Which causes mattered most, and how much.
//
// A why-question asks why an outcome Event came about rather than its contrast, the alternative it is set against:
// a different contrast picks out different causes. It reads the outcome on one measure, a probability or an amount in
// a unit, as it actually was. Each cause is a causal relation (causes, enables, prevents or constrains) ending at the
// outcome, read on the same measure without it, everything else as it was; the gap between the two readings is the
// difference it made, and the differences rank the causes. They do not sum, because causes act together. Where
// several causes would each have brought the outcome about alone, removing any one changes nothing; the reading of
// them removed together says what they did.
//
// One holder asks one question per outcome, contrast and measure, and reads each cause once (once per set of causes
// removed with it). Reading it again replaces the reading, and the model's revision history keeps the earlier one. A
// person's own account of why something happened is a question held by that person, to set beside the modeler's.
//
// A change in a quantity that adds up, such as years of life expectancy gained, is better divided by a Cut over the
// change, whose answers name the cause Events (life_series_record with refersTo); this records everything else.
import { VALUE_TAGS } from './values-record.mjs';
import { createHash } from 'node:crypto';

export const CAUSE_TAGS = VALUE_TAGS;
export const CAUSE_KINDS = Object.freeze(['causes', 'enables', 'prevents', 'constrains']);
export const CAUSE_ROLES = Object.freeze(['enabling', 'trigger', 'sustaining', 'success_condition', 'hindering']);
const BRINGS_ABOUT = new Set(['causes', 'enables']);
const TOLERANCE = 1e-9;
// Below this share of the measure's reach a cause made almost no difference alone.
const NEGLIGIBLE = 0.02;

const digest = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
const questionIdOf = (outcome, contrast, holder, measure, explicitProcess = false) => {
  const parts = [outcome, contrast, holder, unitOf(measure)];
  // Keep identifiers for measures without a process unchanged. Existing questions are found by their complete
  // measure before creating an id, so questions written by an earlier version also keep their identifiers.
  if (measure.process_id || explicitProcess) parts.push(measure.process_id ?? null);
  return `why.${digest(parts)}`;
};
const relationIdOf = (cause, outcome, kind) => `relation.cause.${digest([cause, outcome, kind])}`;
const assessmentIdOf = (questionId, relationId, removedWith) => `cause.${digest([questionId, relationId, [...removedWith].sort()])}`;
const TEXT_BYTES = 1_024;
const bytes = (text) => Buffer.byteLength(String(text), 'utf8');
const clip = (text, max = 300) => { const value = String(text).replace(/\s+/gu, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };
const provenanceOf = (tag, reason) => [`${tag}: ${clip(reason)}`];
const fits = (text, what) => { if (bytes(text) > TEXT_BYTES) throw new Error(`${what} is ${bytes(text)} bytes; keep it under ${TEXT_BYTES} bytes (about 1,000 Latin or 300 other characters).`); };
const unitOf = (measure) => (measure?.kind === 'amount' ? measure.unit : null);
const sameMeasure = (a, b) => (a?.kind ?? null) === (b?.kind ?? null) && unitOf(a) === unitOf(b)
  && (a?.process_id ?? null) === (b?.process_id ?? null);
const bringsAbout = (relation) => BRINGS_ABOUT.has(relation.kind);
const roleFits = (role, kind) => (role === 'hindering') !== BRINGS_ABOUT.has(kind);
const measureName = (measure) => (measure.kind === 'probability' ? 'probability' : measure.unit);

function measureOf(input, processes) {
  if (input === 'probability') return { kind: 'probability' };
  if (!input?.unit) throw new Error('A measure is "probability" or { unit, processId }.');
  if (input.processId && !processes.has(input.processId)) throw new Error(`${input.processId} is not a process of the model; name the process the amount is read on, or leave processId out.`);
  return { kind: 'amount', unit: input.unit, ...(input.processId ? { process_id: input.processId } : {}) };
}

function checkReading(measure, value, what) {
  if (!Number.isFinite(value)) throw new Error(`${what} must be a number.`);
  if (measure.kind === 'probability' && (value < 0 || value > 1)) throw new Error(`${what} is a probability and lies between 0 and 1; got ${value}.`);
  if (measure.kind === 'amount' && value < 0) throw new Error(`${what} is an amount of the outcome and cannot be negative; got ${value}. Read the outcome as a size, such as the years gained or the pounds lost.`);
}

// The difference a cause made: how much less likely or smaller the outcome would have been without one that brings
// it about, how much likelier or larger without one that stands in its way.
export const differenceOf = (relation, question, without) => (bringsAbout(relation) ? question.actual - without : without - question.actual);

export function causeChange(previous, input) {
  const mm = previous.meaning_model;
  if (!mm) throw new Error('The model has no Meaning Model layer, so it has no Events to explain; record Events first.');
  const holder = input.holder;
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const processes = new Set((previous.processes ?? []).map((process) => process.id));
  const relations = [...(mm.event_relations ?? [])];
  const questions = [...(mm.cause_questions ?? [])];
  const assessments = [...(mm.cause_assessments ?? [])];
  const before = new Set(assessments.map((item) => item.id));
  const upsert = {};
  const touched = [];
  const asked = new Set();

  for (const spec of input.questions ?? []) {
    const outcome = events.get(spec.outcomeEventId);
    if (!outcome) throw new Error(`${spec.outcomeEventId} is not an Event of the model; the outcome must be an Event.`);
    fits(spec.contrast, `${spec.outcomeEventId}: the contrast`);
    const measure = measureOf(spec.measure, processes);
    checkReading(measure, spec.actual, `${spec.outcomeEventId}: the actual reading`);
    if (spec.reason) fits(spec.reason, `${spec.outcomeEventId}: the reason`);
    const key = JSON.stringify([spec.outcomeEventId, spec.contrast, unitOf(measure), measure.process_id ?? null]);
    if (asked.has(key)) throw new Error(`Why ${spec.outcomeEventId} came about rather than "${spec.contrast}" is asked twice on one measure in one call; give its causes in one question.`);
    asked.add(key);
    const index = questions.findIndex((question) => question.outcome_event_id === spec.outcomeEventId && question.contrast === spec.contrast
      && question.holder === holder && sameMeasure(question.measure, measure));
    let id = index >= 0 ? questions[index].id : questionIdOf(spec.outcomeEventId, spec.contrast, holder, measure);
    // Earlier versions generated the unbound measure's id for process-bound questions too. If one already owns it,
    // distinguish the new unbound measure explicitly rather than rename or overwrite that earlier question.
    if (index < 0 && questions.some((question) => question.id === id)) id = questionIdOf(spec.outcomeEventId, spec.contrast, holder, measure, true);
    if (index < 0 && questions.some((question) => question.id === id)) throw new Error(`Question id ${id} already belongs to another question.`);
    const question = { id, outcome_event_id: spec.outcomeEventId, contrast: spec.contrast, measure, actual: spec.actual, holder,
      ...(spec.evidenceCutoff === undefined ? {} : { evidence_cutoff: spec.evidenceCutoff }),
      ...(spec.reason ? { reason: spec.reason } : {}), provenance: provenanceOf(spec.tag ?? input.tag, spec.reason ?? input.reason) };
    if (index >= 0) questions[index] = question; else questions.push(question);
    (upsert.cause_questions ??= []).push(question);
    touched.push(id);

    // Each cause: an existing causal relation into the outcome, or one this call links.
    const causeRelation = (cause) => {
      if (cause.relationId) {
        const relation = relations.find((item) => item.id === cause.relationId);
        if (!relation) throw new Error(`${cause.relationId} is not an Event relation of the model.`);
        if (!CAUSE_KINDS.includes(relation.kind)) throw new Error(`${cause.relationId} is a ${relation.kind} relation, which names no cause; weigh a causes, enables, prevents or constrains relation.`);
        if (relation.target_event_id !== spec.outcomeEventId) throw new Error(`${cause.relationId} ends at ${relation.target_event_id}, not at the outcome ${spec.outcomeEventId}.`);
        return relation;
      }
      if (!events.has(cause.eventId)) throw new Error(`${cause.eventId} is not an Event of the model; a cause is an Event, linked to the outcome.`);
      if (cause.eventId === spec.outcomeEventId) throw new Error(`${cause.eventId} cannot cause itself.`);
      const kind = cause.kind ?? (cause.role === 'enabling' ? 'enables' : cause.role === 'hindering' ? 'prevents' : 'causes');
      const linked = relations.filter((item) => item.source_event_id === cause.eventId && item.target_event_id === spec.outcomeEventId && CAUSE_KINDS.includes(item.kind));
      const same = linked.filter((item) => item.kind === kind);
      if (same.length === 1) return same[0];
      if (same.length > 1) throw new Error(`${cause.eventId} has ${same.length} ${kind} relations to ${spec.outcomeEventId}; name the one to weigh with relationId.`);
      // One influence is one relation: a second link in the same direction would be read as a second cause. Without
      // a kind, the role only gives a direction, and the one link in that direction (or the only link) is weighed.
      const parallel = linked.filter((item) => bringsAbout(item) === BRINGS_ABOUT.has(kind));
      if (!cause.kind && parallel.length === 1) return parallel[0];
      if (!cause.kind && !parallel.length && linked.length === 1) return linked[0];
      const named = parallel.map((item) => `${item.kind} (${item.id})`).join(' and ');
      if (parallel.length && !cause.kind) throw new Error(`${cause.eventId} links to ${spec.outcomeEventId} as ${named}; name the one to weigh with relationId.`);
      if (parallel.length) throw new Error(`${cause.eventId} already links to ${spec.outcomeEventId} as ${named}. Weigh that relation: give relationId, or leave kind out. To call it ${kind} instead, change the relation's kind with life_model_revise first.`);
      if (cause.description) fits(cause.description, `${cause.eventId}: the description`);
      const relation = { id: relationIdOf(cause.eventId, spec.outcomeEventId, kind), source_event_id: cause.eventId, target_event_id: spec.outcomeEventId, kind,
        ...(cause.description ? { description: cause.description } : {}), uncertainty: { kind: 'unknown' },
        provenance: provenanceOf(cause.tag ?? spec.tag ?? input.tag, cause.reason ?? spec.reason ?? input.reason) };
      if (relations.some((item) => item.id === relation.id)) throw new Error(`Relation id ${relation.id} already belongs to another relation.`);
      relations.push(relation);
      (upsert.event_relations ??= []).push(relation);
      return relation;
    };

    const read = new Set();
    const resolved = (spec.causes ?? []).map((cause) => ({ cause, relation: causeRelation(cause) }));
    for (const { cause, relation } of resolved) {
      if (cause.role && !roleFits(cause.role, relation.kind)) throw new Error(`${relation.source_event_id}: the role ${cause.role} does not fit ${relation.kind === 'enables' ? 'an' : 'a'} ${relation.kind} relation; a hindering cause prevents or constrains, every other role causes or enables.`);
      checkReading(measure, cause.without, `${relation.source_event_id}: the reading without it`);
      if (bringsAbout(relation) && cause.without > spec.actual + TOLERANCE) throw new Error(`${relation.source_event_id}: without it the outcome reads ${cause.without}, above the actual ${spec.actual}. A cause whose absence would make the outcome likelier or larger stands in its way: give it the kind prevents or constrains.`);
      if (!bringsAbout(relation) && cause.without + TOLERANCE < spec.actual) throw new Error(`${relation.source_event_id}: without it the outcome reads ${cause.without}, below the actual ${spec.actual}. Something whose absence would make the outcome less likely or smaller brings it about: give it the kind causes or enables.`);
      if (cause.band) {
        const [lower, upper] = cause.band;
        checkReading(measure, lower, `${relation.source_event_id}: the band's lower end`);
        checkReading(measure, upper, `${relation.source_event_id}: the band's upper end`);
        if (!(lower <= cause.without && cause.without <= upper)) throw new Error(`${relation.source_event_id}: the band ${lower} to ${upper} must hold the reading ${cause.without}.`);
      }
      fits(cause.reason, `${relation.source_event_id}: the reason`);
      const removedSources = new Set();
      const removedWith = (cause.removedWith ?? []).map((other) => {
        const named = relations.filter((item) => item.target_event_id === spec.outcomeEventId && CAUSE_KINDS.includes(item.kind) && bringsAbout(item) === bringsAbout(relation)
          && (item.id === other || item.source_event_id === other));
        if (!named.length) throw new Error(`${relation.source_event_id} is removed together with ${other}, which is not a cause of ${spec.outcomeEventId} of the same direction; link it as a cause in this call or before.`);
        if (named.length > 1) throw new Error(`${other} names ${named.length} causes of ${spec.outcomeEventId}; give the relation id instead.`);
        if (named[0].source_event_id === relation.source_event_id) throw new Error(`${relation.source_event_id} cannot be removed together with itself, even through another relation.`);
        if (removedSources.has(named[0].source_event_id)) throw new Error(`${relation.source_event_id}: removedWith names cause ${named[0].source_event_id} twice, through one or more relations.`);
        removedSources.add(named[0].source_event_id);
        return named[0].id;
      });
      if (new Set(removedWith).size !== removedWith.length) throw new Error(`${relation.source_event_id}: removedWith names one cause twice.`);
      const pair = JSON.stringify([relation.id, [...removedWith].sort()]);
      if (read.has(pair)) throw new Error(`${relation.source_event_id} is read twice in one question${removedWith.length ? ' with the same causes removed' : ''}.`);
      read.add(pair);
      const at = assessments.findIndex((item) => item.question_id === id && item.relation_id === relation.id
        && JSON.stringify([...(item.removed_with ?? [])].sort()) === JSON.stringify([...removedWith].sort()));
      const assessmentId = at >= 0 ? assessments[at].id : assessmentIdOf(id, relation.id, removedWith);
      if (at < 0 && assessments.some((item) => item.id === assessmentId)) throw new Error(`Assessment id ${assessmentId} already belongs to another assessment.`);
      const record = { id: assessmentId, question_id: id, relation_id: relation.id, ...(cause.role ? { role: cause.role } : {}), without: cause.without,
        ...(cause.band ? { without_band: { lower: cause.band[0], upper: cause.band[1] } } : {}), ...(removedWith.length ? { removed_with: [...removedWith].sort() } : {}),
        reason: cause.reason, provenance: provenanceOf(cause.tag ?? spec.tag ?? input.tag, cause.reason) };
      if (at >= 0) assessments[at] = record; else assessments.push(record);
      (upsert.cause_assessments ??= []).push(record);
    }
    // One cause is read once per question, through one relation, and once per set of causes removed with it: two
    // readings of one Event through two relations would rank one influence twice.
    const sourceOf = (relationId) => relations.find((item) => item.id === relationId)?.source_event_id ?? relationId;
    const keyOf = (item) => JSON.stringify([sourceOf(item.relation_id), (item.removed_with ?? []).map(sourceOf).sort()]);
    const written = new Set((upsert.cause_assessments ?? []).filter((item) => item.question_id === id).map((item) => item.id));
    for (const item of assessments.filter((candidate) => written.has(candidate.id))) {
      const twin = assessments.find((other) => other.question_id === id && other.id !== item.id && keyOf(other) === keyOf(item));
      if (!twin) continue;
      const cause = sourceOf(item.relation_id);
      if (written.has(twin.id)) throw new Error(`${cause} is read twice in this call, through ${twin.relation_id} and ${item.relation_id}; one influence is read once. Read it through one relation.`);
      // Two readings an earlier version allowed: re-reading either one keeps both, so one has to go first.
      if (before.has(item.id)) throw new Error(`${cause} is already read twice on this question, through ${item.relation_id} (${item.id}) and ${twin.relation_id} (${twin.id}); one influence is read once. Remove one of the readings with life_model_revise, remove: {cause_assessments: [...]}, then read the other again.`);
      throw new Error(`${cause} is already read on this question through ${twin.relation_id}; one influence is read once. Read it again through that relation to replace the reading, or remove the other reading (${twin.id}) with life_model_revise.`);
    }
    // A new actual reading must leave the causes read earlier on the right side of it.
    const stale = assessments.filter((item) => item.question_id === id).filter((item) => {
      const relation = relations.find((candidate) => candidate.id === item.relation_id);
      return relation && (bringsAbout(relation) ? item.without > spec.actual + TOLERANCE : item.without + TOLERANCE < spec.actual);
    });
    if (stale.length) throw new Error(`The actual reading ${spec.actual} leaves ${stale.length} earlier reading(s) of this question on the wrong side of it, first ${stale[0].relation_id} at ${stale[0].without}; read them again in this call.`);
  }
  if (!upsert.cause_questions) throw new Error('Give at least one question: an outcome Event, its contrast, a measure, the actual reading and its causes.');
  return { change: { reason: input.reason, provenance: ['life_cause_record'], upsert }, questionIds: touched };
}

// The causes of each question, ranked by the difference each made alone, the readings of causes removed together,
// and where to go next. Never a refusal.
export function causeReport(model, { questionIds = null, holder = null, limit = 24 } = {}) {
  const mm = model.meaning_model ?? {};
  const events = new Map((mm.events ?? []).map((event) => [event.id, event]));
  const relations = new Map((mm.event_relations ?? []).map((relation) => [relation.id, relation]));
  const label = (eventId) => clip(events.get(eventId)?.boundary ?? eventId, 120);
  const next = [];
  const wanted = questionIds ? new Set(questionIds) : null;
  // The questions a call recorded come back in the order it asked them.
  const order = new Map((questionIds ?? []).map((id, index) => [id, index]));
  const questions = (mm.cause_questions ?? []).filter((question) => (!wanted || wanted.has(question.id)) && (!holder || question.holder === holder))
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)).slice(0, limit);
  const report = questions.map((question) => {
    const readings = (mm.cause_assessments ?? []).filter((item) => item.question_id === question.id).map((item) => {
      const relation = relations.get(item.relation_id);
      return { item, relation, difference: relation ? +differenceOf(relation, question, item.without).toPrecision(6) : null };
    }).filter((reading) => reading.relation);
    // One row per cause Event. Readings of one Event through two relations, which earlier versions allowed, show once,
    // with the extra readings named so they can be removed.
    const byCause = new Map();
    for (const reading of readings.filter((item) => !(item.item.removed_with ?? []).length)) {
      const source = reading.relation.source_event_id;
      byCause.set(source, [...(byCause.get(source) ?? []), reading]);
    }
    const twice = [...byCause.values()].filter((list) => list.length > 1);
    for (const list of twice) next.push(`${list[0].relation.source_event_id} is read ${list.length} times on ${question.id}: ${list.map((reading) => `${reading.item.id} through ${reading.relation.id} (${reading.relation.kind})`).join(', ')}. One influence counts once: keep the reading through the relation that states it, and remove the others with life_model_revise, remove: {cause_assessments: [...]}.`);
    const alone = [...byCause.values()].map((list) => list.at(-1))
      .sort((a, b) => b.difference - a.difference || a.relation.source_event_id.localeCompare(b.relation.source_event_id));
    const ranked = alone.map((reading, index) => ({ rank: index + 1, cause: reading.relation.source_event_id, label: label(reading.relation.source_event_id),
      relation: reading.relation.id, kind: reading.relation.kind, ...(reading.item.role ? { role: reading.item.role } : {}),
      ...(byCause.get(reading.relation.source_event_id).length > 1 ? { alsoReadThrough: byCause.get(reading.relation.source_event_id).slice(0, -1).map((item) => item.relation.id) } : {}),
      without: reading.item.without, difference: reading.difference,
      ...(reading.item.without_band ? { band: [reading.item.without_band.lower, reading.item.without_band.upper] } : {}),
      ...(reading.item.reason ? { reason: clip(reading.item.reason, 200) } : {}) }));
    const together = readings.filter((reading) => (reading.item.removed_with ?? []).length).map((reading) => ({
      causes: [reading.relation.source_event_id, ...reading.item.removed_with.map((id) => relations.get(id)?.source_event_id ?? id)],
      without: reading.item.without, difference: reading.difference }));
    const reach = question.measure.kind === 'probability' ? 1 : Math.max(question.actual, 1e-12);
    const slight = ranked.filter((cause) => cause.difference <= NEGLIGIBLE * reach);
    // A relation is unread when nothing reads its cause Event on this question, through it or through another link.
    const covered = new Set(readings.map((reading) => reading.relation.source_event_id));
    const unread = [...relations.values()].filter((relation) => relation.target_event_id === question.outcome_event_id && CAUSE_KINDS.includes(relation.kind) && !covered.has(relation.source_event_id));
    if (slight.length >= 2 && !together.length) next.push(`${slight.map((cause) => cause.cause).slice(0, 3).join(' and ')} each made almost no difference alone to ${question.outcome_event_id}. If each would have been enough without the other, read them removed together (removedWith): that reading says what they did. If they would hold in the contrast too, they do not explain this question, and the low readings stand.`);
    if (unread.length) next.push(`${unread.length} more cause(s) of ${question.outcome_event_id} are linked but not read on this question, beginning with ${unread.slice(0, 3).map((relation) => relation.source_event_id).join(', ')}; read each, so the ranking covers them.`);
    if (ranked.length === 1 && !unread.length) next.push(`${question.outcome_event_id} has one cause read on this question. What else made it come about rather than "${clip(question.contrast, 80)}"? A ranking needs the rivals.`);
    return { question: question.id, outcome: question.outcome_event_id, label: label(question.outcome_event_id), contrast: question.contrast,
      measure: measureName(question.measure), ...(question.measure.process_id ? { processId: question.measure.process_id } : {}), actual: question.actual, holder: question.holder,
      ...(question.evidence_cutoff === undefined ? {} : { evidenceCutoff: question.evidence_cutoff }), ranked, ...(together.length ? { together } : {}),
      ...(unread.length ? { unread: unread.map((relation) => relation.source_event_id).slice(0, 12) } : {}) };
  });
  return { questions: report, next,
    reading: 'difference is how much less likely or smaller the outcome would have been without the cause (likelier or larger without one that stands in its way), everything else as it was. Differences rank causes and do not sum: causes act together.' };
}
