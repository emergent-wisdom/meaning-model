// How much Events matter, and to whom.
//
// An importance scale names an audience, the inhabitants of a world or those of them who follow one category, and its
// levels, the most important first, each with an anchor that says what an Event must be to stand there. A judgment
// places one Event at one level of one scale, once per holder; judging it again replaces the level, and the model's
// revision history keeps the earlier one. Importance chooses what a reader is shown: the viewer can keep to the top
// level of a scale, then the top two, and so on. It is not containment (what an Event is part of), not a Cut's shares,
// and not a process value.
//
// The result reports what to do next rather than refusing: Events with no level on a scale for the whole audience, and
// a top level so full that it no longer picks anything out.
import { VALUE_TAGS } from './values-record.mjs';
import { createHash } from 'node:crypto';
import { worldEvents } from './world-events.mjs';

export const IMPORTANCE_TAGS = VALUE_TAGS;
const LEVEL_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
const MIN_LEVELS = 2, MAX_LEVELS = 12;

// A go-to scale for any audience: how few Events of the whole span stand this high for it.
export const IMPORTANCE_PRESETS = Object.freeze({
  rarity: Object.freeze([
    ['top_10', 'One of the ten or so most important Events of the whole span for this audience.'],
    ['top_100', 'One of the hundred or so most important.'],
    ['top_1000', 'One of the thousand or so most important.'],
    ['noted', 'Worth recording, below the thousand most important.'],
  ]),
});

// A judgment is found by its Event, scale and holder, never by a joined id; the id below only names a new one.
// A judgment is found by its Event, scale and holder; a new id is a digest of all three, so no two tuples share one and
// its length is bounded however the parts are written.
const judgmentIdOf = (scaleId, eventId, holder) => `importance.${createHash('sha256').update(JSON.stringify([scaleId, eventId, holder])).digest('hex').slice(0, 24)}`;
// The engine bounds each text of these records at 1,024 bytes. A provenance entry carries the reason clipped to a
// sentence or two; the judgment's own reason, the audience and the anchors are refused with a plain message when longer.
const TEXT_BYTES = 1_024;
const bytes = (text) => Buffer.byteLength(String(text), 'utf8');
const clip = (text, max = 300) => { const value = String(text).replace(/\s+/gu, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; };
const provenanceOf = (tag, reason) => [`${tag}: ${clip(reason)}`];
const fits = (text, what) => { if (bytes(text) > TEXT_BYTES) throw new Error(`${what} is ${bytes(text)} bytes; keep it under ${TEXT_BYTES} bytes (about 1,000 Latin or 300 other characters).`); };

// The Events importance is judged for: what happens in the world (world-events.mjs).
export const judgeableEvents = worldEvents;

export function importanceChange(previous, input) {
  const mm = previous.meaning_model;
  if (!mm) throw new Error('The model has no Meaning Model layer, so it has no Events to judge; record Events first.');
  const holder = input.holder;
  const events = new Set((mm.events ?? []).map((event) => event.id));
  const concepts = new Set((mm.concepts ?? []).map((concept) => concept.id));
  const scales = new Map((mm.importance_scales ?? []).map((scale) => [scale.id, scale]));
  const judgments = [...(mm.event_importance ?? [])];
  const upsert = {};

  for (const spec of input.scales ?? []) {
    const existing = scales.get(spec.id);
    const pairs = spec.levels ?? (spec.preset ? IMPORTANCE_PRESETS[spec.preset] : null);
    if (spec.levels && spec.preset) throw new Error(`${spec.id}: give levels or a preset, not both.`);
    if (!pairs && !existing) throw new Error(`${spec.id}: a new scale needs its levels, the most important first, or a preset (${Object.keys(IMPORTANCE_PRESETS).join(', ')}).`);
    const levels = pairs ? pairs.map(([key, anchor]) => ({ key, anchor })) : existing.levels;
    if (levels.length < MIN_LEVELS || levels.length > MAX_LEVELS) throw new Error(`${spec.id}: a scale has ${MIN_LEVELS} to ${MAX_LEVELS} levels.`);
    const keys = levels.map((level) => level.key);
    for (const key of keys) if (!LEVEL_KEY.test(key)) throw new Error(`${spec.id}: level key ${key} must start with a lowercase letter and hold only lowercase letters, digits and underscores.`);
    if (new Set(keys).size !== keys.length) throw new Error(`${spec.id}: a level key appears twice.`);
    const audience = spec.audience ?? existing?.audience;
    if (!audience) throw new Error(`${spec.id}: say whose judgment this is, as the audience: the world's inhabitants, or those who follow one category.`);
    fits(audience, `${spec.id}: the audience`);
    for (const level of levels) fits(level.anchor, `${spec.id}: the anchor of ${level.key}`);
    const concept = spec.concept === undefined ? existing?.concept_id : spec.concept;
    if (concept && !concepts.has(concept)) throw new Error(`${spec.id}: ${concept} is not a Concept of the model; name the category's Concept, or leave concept out.`);
    const record = { id: spec.id, audience, ...(concept ? { concept_id: concept } : {}), levels,
      provenance: provenanceOf(spec.tag ?? input.tag, spec.reason ?? input.reason) };
    (upsert.importance_scales ??= []).push(record);
    scales.set(spec.id, record);
  }

  const seen = new Set();
  for (const item of input.judgments ?? []) {
    if (!events.has(item.eventId)) throw new Error(`${item.eventId} is not an Event of the model.`);
    const scale = scales.get(item.scaleId);
    if (!scale) throw new Error(`${item.scaleId} is not an importance scale of the model; declare it in scales first.`);
    if (!scale.levels.some((level) => level.key === item.level)) throw new Error(`${item.eventId}: ${item.level} is not a level of ${item.scaleId} (${scale.levels.map((level) => level.key).join(', ')}).`);
    if (item.reason) fits(item.reason, `${item.eventId}: the reason`);
    const pair = `${item.eventId}\u0000${item.scaleId}`;
    if (seen.has(pair)) throw new Error(`${item.eventId} is judged twice on ${item.scaleId} in one call.`);
    seen.add(pair);
    const index = judgments.findIndex((judgment) => judgment.event_id === item.eventId && judgment.scale_id === item.scaleId && judgment.holder === holder);
    const id = index >= 0 ? judgments[index].id : judgmentIdOf(item.scaleId, item.eventId, holder);
    if (index < 0 && judgments.some((judgment) => judgment.id === id)) throw new Error(`Judgment id ${id} already belongs to another judgment.`);
    const record = { id, event_id: item.eventId, scale_id: item.scaleId, level: item.level, holder,
      ...(item.reason ? { reason: item.reason } : {}), provenance: provenanceOf(item.tag ?? input.tag, item.reason ?? input.reason) };
    if (index >= 0) judgments[index] = record; else judgments.push(record);
    (upsert.event_importance ??= []).push(record);
  }
  // Levels are a scale's meaning: one still in use cannot disappear from under the judgments that name it.
  const orphaned = judgments.filter((judgment) => !scales.get(judgment.scale_id)?.levels.some((level) => level.key === judgment.level));
  if (orphaned.length) throw new Error(`${orphaned.length} judgment(s) use a level their scale no longer has, first ${orphaned[0].event_id} at ${orphaned[0].level} on ${orphaned[0].scale_id}; judge them again in the same call, or keep the level.`);
  if (!upsert.importance_scales && !upsert.event_importance) throw new Error('Give scales to declare or judgments to record.');
  return { reason: input.reason, provenance: ['life_importance_record'], upsert };
}

// Each scale's levels and how full they are, and where to go next. Never a refusal.
export function importanceReport(model, { holder = null } = {}) {
  const mm = model.meaning_model ?? {};
  const events = judgeableEvents(mm);
  const judgments = (mm.event_importance ?? []).filter((judgment) => !holder || judgment.holder === holder);
  const next = [];
  const scales = (mm.importance_scales ?? []).map((scale) => {
    const mine = judgments.filter((judgment) => judgment.scale_id === scale.id);
    const judged = new Set(mine.map((judgment) => judgment.event_id));
    const levels = scale.levels.map((level, index) => ({ level: level.key, rank: index + 1, events: mine.filter((judgment) => judgment.level === level.key).length }));
    const top = mine.filter((judgment) => judgment.level === scale.levels[0].key).map((judgment) => judgment.event_id);
    // A scale for a category's audience judges the Events that matter to it; one for the whole audience judges them all.
    const unjudged = scale.concept_id ? [] : events.filter((event) => !judged.has(event.id)).map((event) => event.id);
    if (judged.size >= 8 && top.length > judged.size / 4) next.push(`The top level of ${scale.id} holds ${top.length} of its ${judged.size} Events. Keep the top rare so the most important stand out: move the rest down a level.`);
    if (unjudged.length) next.push(`${unjudged.length} Event(s) have no level on ${scale.id}, beginning with ${unjudged.slice(0, 3).join(', ')}. Give each one, so the viewer can keep to the most important.`);
    return { scale: scale.id, audience: scale.audience, ...(scale.concept_id ? { concept: scale.concept_id } : {}), judged: judged.size, levels,
      top: top.slice(0, 20), ...(unjudged.length ? { unjudgedCount: unjudged.length, unjudged: unjudged.slice(0, 20) } : {}) };
  });
  if (!scales.length && events.length) next.push('Declare a scale for the whole audience, such as everyone who lives in this world, and give every Event a level on it; add a scale for each category whose followers would rank its Events differently.');
  return { scales, next, viewer: 'In the viewer, importance=<scale id> keeps to that scale\'s top level and importanceTop=<n> to its top n levels.' };
}
