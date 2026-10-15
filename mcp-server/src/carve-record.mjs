// The conceptual decomposition as one recorded step.
//
// The process breakdown asks that every carve be recorded: the claim frame, the climb to the root, the four tests for
// each candidate, the search for what is missing, real cases routed through it, and how the parts make the whole work.
// One call records all of it. The concepts, the kind-of relations of the climb and the abstract cut go into the model
// by one revision; the frame, the verdicts with their reasons and the synthesis go into the Understanding Graph as notes
// held by the modeler, linked to those records. The parts are not opened here: a part becomes a process only with a
// measure and values (the number test), so the result gives each one as a life_values_record entry to complete.
//
// The revision never edits a concept or a process that already exists. The cut's provenance names the process it
// divides and the process each part is (carve-index.mjs), short lines name each verdict, and the reasons, which can be
// long, live only in the notes, since every text field of the meaning layer holds at most 1,024 bytes.
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { applyModelChange } from './model-change.mjs';
import { readGraph, recordUnderstanding } from './construction-record.mjs';
import { rebindNarrativeGraph } from './narrative-rebind.mjs';
import { resolveAppendHead } from './graph-head.mjs';
import { PROCESS_ID, VALUE_TAGS, deepenOf } from './values-record.mjs';
import { CARVE_MARK, DIVIDES_LINE, PART_LINE, KEPT_WHOLE_LINE, KEPT_SIGNALS_LINE } from './carve-index.mjs';

export const CARVE_SCHEMA = 'meaning-model-carve/v1';
export const CARVE_OUTCOMES = Object.freeze(['part', 'kind', 'frontier', 'merged', 'routed', 'dropped']);
const TESTS = Object.freeze(['necessity', 'independence', 'universality']);
const MEANING_SCHEMA = 'life-sim-rust-meaning-model/v1';
// Every text of the meaning layer (a label, a differentia, a lens, a query, each provenance line) holds 1,024 bytes.
const FIELD_BYTES = 1_000;

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max) => z.string().trim().min(1).max(max);
const recordId = z.string().trim().min(1).max(512).regex(/^\S+$/u, 'An id has no spaces.');
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u, 'A key is a short slug: letters, digits, - and _.');
const verdict = z.object({ verdict: z.enum(['pass', 'fail', 'uncertain']), reason: text(2_000) }).strict();

export const carveRecordSchema = z.object({
  requestId: id,
  previousModelHash: hash,
  holder: id.describe('Whose carve this is, such as the model you are.'),
  tag: z.enum(VALUE_TAGS).describe('What the carve rests on: source, inferred, invented, exploring or sketch.'),
  graph: z.object({ graphHash: hash, accessScopes: z.array(id).min(1).max(64) }).strict().optional()
    .describe('The Understanding Graph bound to this model or an earlier revision of it. It is rebound to the new revision, and the frame, the verdicts and the synthesis are recorded in it as notes held by holder. Without it they stay only as short lines in the cut\'s provenance.'),
  concept: z.object({
    id: recordId.describe('The concept carved: an existing one, or a new one to add.'),
    label: text(300).optional().describe('Its name, for a concept the model does not have yet; the frame\'s concept is used when left out.'),
    process: z.string().regex(PROCESS_ID).optional().describe('The process this carve divides, existing or to open; its parts are filed under it.'),
  }).strict(),
  frame: z.object({
    concept: text(2_000).describe('What the concept is: the whole being promised, such as "a human life".'),
    purpose: text(2_000).describe('What the carve is for, such as "to follow how a person changes across a whole life".'),
    range: text(2_000).describe('The range it claims: every case the parts must hold for, such as "every human society from 300,000 years ago to now".'),
  }).strict().describe('The claim frame, stated before carving: it makes necessary, universal and complete checkable.'),
  ascent: z.array(z.object({
    id: recordId.optional().describe('The concept of this broader kind; made from the label when left out.'),
    label: text(300),
    differentia: text(1_000).optional().describe('What sets the kind just below apart from the other kinds within this one.'),
    siblings: z.array(text(300)).max(32).optional().describe('Other kinds within this one, beside the kind just below, that exist or plausibly could.'),
  }).strict()).max(16).default([]).describe('Climb before you carve: the next broader kind, nearest first, up to the root. Each step becomes a kind-of relation.'),
  candidates: z.array(z.object({
    key,
    label: text(300),
    meaning: text(1_000).describe('What the candidate covers.'),
    necessity: verdict.describe('Relative to what the concept promises: if it were removed, would the whole still work?'),
    independence: verdict.describe('Can it change or be redone without forcing the same change in the others? Low coupling is enough.'),
    universality: verdict.describe('Does every case in the claimed range contain it? One found only in some cases is a kind, not a part.'),
    outcome: z.enum(CARVE_OUTCOMES).optional().describe('part, kind, frontier, merged, routed or dropped. Left out: a part when the three tests pass, a kind when only universality fails, otherwise a frontier alternative.'),
    kindOf: recordId.optional().describe('For a kind: the part (by key) or concept it is a kind of.'),
    mergedInto: key.optional().describe('For a merged candidate: the part it was merged into.'),
    routedTo: text(500).optional().describe('For a routed candidate: where its cases go instead.'),
    conceptId: recordId.optional().describe('The concept it becomes; defaults to <concept id>.<key>.'),
    processId: z.string().regex(PROCESS_ID).optional().describe('The process a part is, existing or to open; defaults to <concept.process>.<key>.'),
    measure: z.object({ unit: text(300).optional(), meaning: text(1_000).optional() }).strict().optional()
      .describe('The number test: what the part is measured in, and what its numbers mean.'),
  }).strict()).min(1).max(48).describe('More candidates than you keep, each with its three verdicts and reasons.'),
  completeness: z.object({
    verdict: z.enum(['pass', 'fail', 'uncertain']),
    reason: text(4_000),
    checkedAgainst: text(1_000).optional().describe('An outside list made by someone else for another purpose, such as the Outline of Cultural Materials.'),
    missing: z.array(text(500)).max(32).optional().describe('What still has no home.'),
  }).strict().describe('Taken together, with everything addressed, would the parts make a working instance of the whole?'),
  routing: z.array(z.object({
    case: text(1_000),
    homes: z.array(key).max(8).describe('The candidates the case belongs to, by key: none shows a missing part, two show two parts that are not independent.'),
  }).strict()).max(200).optional().describe('Real cases sent through the carve, frozen before carving.'),
  synthesis: text(8_000).describe('How the parts together make the whole work.'),
  form: z.enum(['processes', 'cut']).default('processes').describe('processes: parts that can all rise together, each its own process; cut: categories competing for one pool, the answers of one Cut.'),
  cutId: recordId.optional().describe('The carve\'s abstract cut; defaults to carve.<concept id>, so carving the same concept again revises it.'),
  supersedes: recordId.optional().describe('An earlier carve, by abstract cut id, that this one replaces: it is withdrawn and kept as history.'),
  keepWhole: z.object({ reason: text(4_000).describe('Why no carve of it pays now: what the candidates showed, and what evidence would reopen it.') }).strict().optional()
    .describe('The answer to the deepen check when the process stays whole: concept.process names it, the climb names at least its next broader kind, and the candidates are those you tried. It is recorded as a kept-whole relation from the concept to that kind, with the signals it was taken with; the values report leaves the process out of the deepen check until its Events or unexplained moves grow by half.'),
  sema: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]+#[0-9a-f]{4,64}$/u)).max(16).optional().describe('Sema patterns used, such as ConceptualDecomposition#f1f4, cited in the record.'),
  reason: text(4_000),
}).strict().superRefine((input, context) => {
  const keys = input.candidates.map((candidate) => candidate.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: ['candidates'], message: 'Candidate keys must be unique.' });
  for (const [index, item] of (input.routing ?? []).entries()) {
    const unknown = item.homes.filter((home) => !keys.includes(home));
    if (unknown.length) context.addIssue({ code: 'custom', path: ['routing', index, 'homes'], message: `${unknown.join(', ')} ${unknown.length > 1 ? 'are not candidate keys' : 'is not a candidate key'}.` });
  }
  for (const [index, candidate] of input.candidates.entries()) {
    if (candidate.mergedInto && !keys.includes(candidate.mergedInto)) context.addIssue({ code: 'custom', path: ['candidates', index, 'mergedInto'], message: `${candidate.mergedInto} is not a candidate key.` });
  }
});

// A text cut to the byte bound of a meaning-layer field, at a character boundary, the same way every time.
export function clipBytes(value, max = FIELD_BYTES) {
  const textValue = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (Buffer.byteLength(textValue, 'utf8') <= max) return textValue;
  let out = '';
  for (const character of textValue) {
    if (Buffer.byteLength(`${out}${character}…`, 'utf8') > max) break;
    out += character;
  }
  return `${out.trimEnd()}…`;
}
const slug = (value) => String(value).toLowerCase().normalize('NFKD').replace(/['\u2019]/gu, '').replace(/^(?:a|an|the)\s+/u, '')
  .replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'kind';

// What a candidate becomes. A part must pass all three tests: a declared part that does not is a contradiction.
export function outcomeOf(candidate) {
  const open = TESTS.filter((test) => candidate[test].verdict !== 'pass');
  if (candidate.outcome) {
    if (candidate.outcome === 'part' && open.length) {
      throw new Error(`${candidate.key} is kept as a part, but ${open.map((test) => `${test} ${candidate[test].verdict === 'fail' ? 'fails' : 'is uncertain'}`).join(' and ')}. Keep a part only when the tests hold: record it as a kind when only universality fails, merged into another part when it cannot vary apart from it, a frontier alternative while it stays uncertain, or reframe the claim.`);
    }
    return candidate.outcome;
  }
  if (!open.length) return 'part';
  if (open.length === 1 && open[0] === 'universality' && candidate.universality.verdict === 'fail') return 'kind';
  return 'frontier';
}
const verdictLine = (candidate, outcome) => `tested ${candidate.key}: necessity ${candidate.necessity.verdict}, independence ${candidate.independence.verdict}, universality ${candidate.universality.verdict}; ${outcome}`;

// The model change of one carve, and the plan the rest of the call works from. Pure: it reads the predecessor only.
export function carveChange(previous, input) {
  const mm = previous.meaning_model ?? { schema: MEANING_SCHEMA };
  const concepts = new Map((mm.concepts ?? []).map((concept) => [concept.id, concept]));
  const relations = mm.abstract_relations ?? [];
  const relationIds = new Set(relations.map((relation) => relation.id));
  const cuts = new Map((mm.abstract_cuts ?? []).map((cut) => [cut.id, cut]));
  const processes = new Set((previous.processes ?? []).map((process) => process.id));
  const parentOf = new Map((previous.decomposition ?? []).map((edge) => [edge.child, edge.parent]));
  const wholeId = input.concept.id;
  const label = input.concept.label ?? concepts.get(wholeId)?.label ?? clipBytes(input.frame.concept, 300);
  const cutId = input.cutId ?? `carve.${wholeId}`;
  const holderLine = `${input.tag}: ${CARVE_MARK} by ${input.holder}`;
  const upsertConcepts = []; const upsertRelations = [];
  const createdConcepts = []; const reusedConcepts = [];
  // A concept the model lacks is added once; one it has is never edited.
  const ensureConcept = (conceptId, conceptLabel, differentia, extra = []) => {
    if (concepts.has(conceptId)) { if (!reusedConcepts.includes(conceptId)) reusedConcepts.push(conceptId); return; }
    const record = { id: conceptId, label: clipBytes(conceptLabel, 300), differentia: differentia ? [clipBytes(differentia)] : [], boundary: null,
      state_schema: {}, direction_families: [], observation_methods: [], provenance: [holderLine, ...extra.map((line) => clipBytes(line))] };
    concepts.set(conceptId, record); upsertConcepts.push(record); createdConcepts.push(conceptId);
  };
  // A kind-of relation, general to specific, unless the model already holds it.
  const specialize = (general, specific) => {
    const existing = [...relations, ...upsertRelations].find((relation) => relation.kind === 'specialization' && relation.source_concept_id === general && relation.target_concept_id === specific);
    if (existing) return existing.id;
    let relationId = `spec.${general}.${specific}`;
    for (let n = 2; relationIds.has(relationId); n += 1) relationId = `spec.${general}.${specific}.${n}`;
    relationIds.add(relationId);
    upsertRelations.push({ id: relationId, source_concept_id: general, target_concept_id: specific, kind: 'specialization', provenance: [holderLine, clipBytes(`the climb before carving ${wholeId}`)] });
    return relationId;
  };

  // The climb: the concept is a kind of the first step, each step a kind of the next.
  const ascent = input.ascent.map((step) => ({ ...step, id: step.id ?? `concept.${slug(step.label)}` }));
  if (ascent.some((step) => step.id === wholeId)) throw new Error(`The climb names ${wholeId}, the concept being carved; each step is a broader kind.`);
  // A step named by its label alone that would add a concept the model may already hold under another id.
  const byLabel = new Map([...concepts.values()].map((concept) => [String(concept.label ?? '').trim().toLowerCase(), concept.id]));
  const sameLabel = input.ascent.flatMap((step, index) => (!step.id && !concepts.has(ascent[index].id) && byLabel.has(step.label.trim().toLowerCase())
    ? [{ step: step.label, added: ascent[index].id, existing: byLabel.get(step.label.trim().toLowerCase()) }] : []));
  ensureConcept(wholeId, label, ascent[0]?.differentia);
  ascent.forEach((step, index) => ensureConcept(step.id, step.label, ascent[index + 1]?.differentia));
  const climb = ascent.map((step, index) => specialize(step.id, index === 0 ? wholeId : ascent[index - 1].id));

  // The candidates, each with what it becomes.
  const judged = input.candidates.map((candidate) => ({ candidate, outcome: outcomeOf(candidate) }));
  const byKey = new Map(judged.map((item) => [item.candidate.key, item]));
  const partConcept = (candidate) => candidate.conceptId ?? `${wholeId}.${candidate.key}`;
  const parts = judged.filter((item) => item.outcome === 'part').map(({ candidate }) => {
    const conceptId = partConcept(candidate);
    if (conceptId === wholeId) throw new Error(`${candidate.key} names the concept being carved as its own concept.`);
    const processId = input.form === 'processes' ? (candidate.processId ?? (input.concept.process ? `${input.concept.process}.${candidate.key}` : null)) : null;
    return { key: candidate.key, label: candidate.label, conceptId, processId, candidate };
  });
  const partIds = parts.map((part) => part.conceptId);
  if (new Set(partIds).size !== partIds.length) throw new Error('Two parts name the same concept; give each its own conceptId.');
  const partProcesses = parts.map((part) => part.processId).filter(Boolean);
  if (new Set(partProcesses).size !== partProcesses.length) throw new Error('Two parts name the same process; give each its own processId.');
  if (input.concept.process && partProcesses.includes(input.concept.process)) throw new Error(`A part names ${input.concept.process}, the process being divided.`);
  for (const part of parts) ensureConcept(part.conceptId, part.label, part.candidate.meaning, [`a part of ${wholeId} in the carve ${cutId}`]);
  // The lines that link the carve to its processes are read back whole, so they are never clipped.
  const linkLines = [...(input.form === 'processes' && input.concept.process ? [`${DIVIDES_LINE}${input.concept.process}`] : []),
    ...parts.filter((part) => part.processId).map((part) => `${PART_LINE}${part.conceptId}=${part.processId}`)];
  const tooLong = linkLines.find((line) => Buffer.byteLength(line, 'utf8') > FIELD_BYTES);
  if (tooLong) throw new Error(`The carve cannot name its process in one provenance line of at most ${FIELD_BYTES} bytes: ${tooLong.slice(0, 80)}…; use shorter concept or process ids.`);
  // A kind is a narrower carve under the part or concept it is a kind of; without kindOf it stays in the notes.
  const kinds = judged.filter((item) => item.outcome === 'kind').map(({ candidate }) => {
    if (!candidate.kindOf) return { key: candidate.key, label: candidate.label, conceptId: null, kindOf: null };
    const general = byKey.get(candidate.kindOf) ? partConcept(byKey.get(candidate.kindOf).candidate) : candidate.kindOf;
    if (byKey.get(candidate.kindOf) && byKey.get(candidate.kindOf).outcome !== 'part') throw new Error(`${candidate.key} is a kind of ${candidate.kindOf}, which is not a part of this carve; name a part or a concept.`);
    if (!concepts.has(general)) throw new Error(`${candidate.key} is a kind of ${candidate.kindOf}, which is neither a candidate key nor a concept of the model.`);
    const conceptId = candidate.conceptId ?? `${general}.${candidate.key}`;
    ensureConcept(conceptId, candidate.label, candidate.meaning, [`a kind found while carving ${wholeId}`]);
    specialize(general, conceptId);
    return { key: candidate.key, label: candidate.label, conceptId, kindOf: general };
  });
  // The answer that a process stays whole: a relation from the concept to its next broader kind, never an edit.
  let kept = null;
  if (input.keepWhole) {
    const process = input.concept.process;
    if (!process || !processes.has(process)) throw new Error('keepWhole records that a process stays whole: name it in concept.process, a process the model has.');
    if (!ascent.length) throw new Error('keepWhole needs the climb: name at least the next broader kind the concept is a kind of, so the decision says what it stays whole as.');
    if (parts.length >= 2) throw new Error(`keepWhole contradicts the verdicts: ${parts.map((part) => part.key).join(', ')} pass all three tests, which makes a carve. Record the carve, or say in the verdicts why a part does not hold.`);
    const signal = deepenOf(previous).signals.find((item) => item.process === process) ?? { events: 0, unexplained: 0 };
    const relationId = `kept-whole.${process}`;
    upsertRelations.push({ id: relationId, source_concept_id: wholeId, target_concept_id: ascent[0].id, kind: 'other', label: 'kept whole',
      provenance: [holderLine, `${KEPT_WHOLE_LINE}${process}`, `${KEPT_SIGNALS_LINE}events=${signal.events};unexplained=${signal.unexplained}`, clipBytes(`why: ${input.keepWhole.reason}`)] });
    kept = { process, relationId, events: signal.events, unexplained: signal.unexplained, replaced: relationIds.has(relationId) };
  }
  // The routing sample read against the accepted parts: a case whose homes are all set aside has no home among them.
  const partKeys = new Set(parts.map((part) => part.key));
  const routedCases = (input.routing ?? []).map((item) => ({ ...item, partHomes: item.homes.filter((home) => partKeys.has(home)) }));
  const noHome = routedCases.filter((item) => !item.partHomes.length);
  const twoHomes = routedCases.filter((item) => item.partHomes.length > 1);
  // The carve this concept is a part of, whose frame this one must serve.
  const parentCarve = [...cuts.values()].find((cut) => !cut.withdrawn && cut.id !== cutId && (cut.child_concept_ids ?? []).includes(wholeId)) ?? null;
  const others = (outcome) => judged.filter((item) => item.outcome === outcome).map(({ candidate }) => ({ key: candidate.key, label: candidate.label,
    open: TESTS.filter((test) => candidate[test].verdict !== 'pass'), ...(candidate.mergedInto ? { mergedInto: candidate.mergedInto } : {}), ...(candidate.routedTo ? { routedTo: candidate.routedTo } : {}) }));

  // The cut itself, when at least two parts passed: the engine's rule, and what makes it a carve.
  const cutRecorded = parts.length >= 2;
  const upsertCuts = [];
  const previousCut = cuts.get(cutId) ?? null;
  if (input.supersedes && input.supersedes === cutId) throw new Error(`supersedes names ${cutId}, this carve's own id: carving under the same id already revises it. supersedes names a different carve it replaces.`);
  if (input.supersedes && !cuts.has(input.supersedes)) throw new Error(`supersedes names ${input.supersedes}, which is not an abstract cut of the model.`);
  if (cutRecorded) {
    upsertCuts.push({ id: cutId, parent_concept_id: wholeId, child_concept_ids: partIds,
      lens: clipBytes(`${input.frame.purpose} Range: ${input.frame.range}`),
      query: clipBytes(`What differentiated parts must ${label} address to exist and function across every case it claims?`),
      provenance: [holderLine,
        ...linkLines,
        ...(input.form === 'cut' ? ['form:cut, the parts are the answers of one Cut'] : []),
        ...judged.map(({ candidate, outcome }) => clipBytes(verdictLine(candidate, outcome))),
        clipBytes(`completeness ${input.completeness.verdict}${input.completeness.checkedAgainst ? `, checked against ${input.completeness.checkedAgainst}` : ''}`),
        ...(input.ascent.length ? [] : ['no-climb: carved before it was located among broader kinds']),
        ...(routedCases.length ? [clipBytes(`routing: ${routedCases.length} case(s), ${noHome.length} with no home among the parts, ${twoHomes.length} with two or more`)] : []),
        ...(input.graph ? [] : [clipBytes(`synthesis: ${input.synthesis}`)]),
        ...(input.sema ?? []).map((ref) => `sema:${ref}`)] });
    if (input.supersedes) {
      const old = structuredClone(cuts.get(input.supersedes));
      old.withdrawn = { reason: clipBytes(`Replaced by the carve ${cutId}: ${input.reason}`), superseded_by: [cutId] };
      upsertCuts.push(old);
    }
  }
  // Other current carves of the same concept stay beside this one, as carves under other lenses.
  const besides = [...cuts.values()].filter((cut) => cut.parent_concept_id === wholeId && cut.id !== cutId && cut.id !== input.supersedes && !cut.withdrawn).map((cut) => cut.id);

  const upsert = {};
  if (upsertConcepts.length) upsert.concepts = upsertConcepts;
  if (upsertRelations.length) upsert.abstract_relations = upsertRelations;
  if (upsertCuts.length) upsert.abstract_cuts = upsertCuts;
  const change = Object.keys(upsert).length ? { reason: input.reason, provenance: [CARVE_MARK, `holder:${input.holder}`], upsert } : null;
  // Where each part stands as a process: to open, to file under the whole, or already in place.
  const placed = parts.map((part) => {
    if (!part.processId) return { ...part, process: null };
    if (!processes.has(part.processId)) return { ...part, process: 'to open' };
    const current = parentOf.get(part.processId) ?? null;
    if (!input.concept.process || current === input.concept.process) return { ...part, process: 'open' };
    return { ...part, process: current ? 'to move' : 'to file', currentParent: current };
  });
  return { change, plan: { cutId, conceptId: wholeId, label, cutRecorded, previousCut, besides, ascent, climb, parts: placed, kinds,
    frontier: others('frontier'), merged: others('merged'), routed: others('routed'), dropped: others('dropped'), judged,
    createdConcepts, reusedConcepts, relations: upsertRelations.map((relation) => relation.id), wholeProcess: input.concept.process ?? null,
    wholeProcessExists: input.concept.process ? processes.has(input.concept.process) : null, hadMeaningModel: Boolean(previous.meaning_model),
    kept, noHome, twoHomes, parentCarve, sameLabel } };
}

// What life_values_record still needs to open each part: a template, never a call to send as it is.
export function openTemplates(plan, input) {
  if (input.form === 'cut') {
    return [{ tool: 'life_series_record', series: { answers: plan.parts.map((part) => ({ key: part.key.slice(0, 64), meaning: clipBytes(part.candidate.meaning, 1_000) })) },
      needs: ['subject: the Thing whose pool this is', 'series id, question and unit: the pool the answers divide', 'readings: the shares at each dated interval, each with why and a tag'] }];
  }
  const templates = [];
  if (plan.wholeProcess && !plan.wholeProcessExists) {
    templates.push({ processId: plan.wholeProcess, process: { label: plan.label }, needs: ['process.unit (or a scale or states): a measure of the whole that passes the number test', 'points: at least one dated value, with a tag and an honest band'] });
  }
  for (const part of plan.parts) {
    if (!part.processId) continue;
    if (part.process === 'to open') {
      const measure = part.candidate.measure ?? {};
      templates.push({ processId: part.processId, process: { label: part.label, ...(measure.unit ? { unit: measure.unit } : {}), meaning: clipBytes(measure.meaning ?? part.candidate.meaning, 1_000), ...(plan.wholeProcess ? { parent: plan.wholeProcess } : {}) },
        needs: [...(measure.unit ? [] : ['process.unit (or a scale or states): a measure that passes the number test']), 'points: at least one dated value, with a tag and an honest band; values over the whole span'] });
    } else if (part.process === 'to file') {
      templates.push({ processId: part.processId, process: { parent: plan.wholeProcess }, needs: [] });
    } else if (part.process === 'to move') {
      templates.push({ processId: part.processId, needs: [`it is part of ${part.currentParent} now: move its decomposition edge to ${plan.wholeProcess} with life_model_revise`] });
    }
  }
  return templates;
}

// The notes of a carve: the frame and the climb, the four tests (in more than one note when long), and the parts with how
// they make the whole work.
export function carveNotes(plan, input, { prefix, previous = {} }) {
  const lines = (items) => items.filter((item) => typeof item === 'string').join('\n');
  const sentence = (value) => (/[.!?…]$/u.test(value.trim()) ? value.trim() : `${value.trim()}.`);
  const record = (kind, recordIdValue) => ({ record: `${kind}:${recordIdValue}` });
  const conceptTargets = (ids) => ids.map((conceptId) => record('concept', conceptId));
  const cutTarget = plan.cutRecorded ? [record('abstract_cut', plan.cutId)] : [record('concept', plan.conceptId)];
  const bounded = (targets) => targets.slice(0, 32);
  const chain = [plan.label, ...plan.ascent.map((step) => step.label)];
  // The frame and the climb, in as many notes as the climb needs (a note holds 64,000 characters, and a climb of many
  // steps, each with its sibling kinds, can pass it): the first holds the frame, and each later one goes on with it. The
  // data names each step by id and label; its differentia and sibling kinds are in the text, so nothing long is stored twice.
  const stepLine = (step, index) => `${index + 1}. ${chain[index]} is a kind of ${step.label}${step.differentia ? `: ${sentence(step.differentia)}` : '.'}${step.siblings?.length ? ` Other kinds within it: ${step.siblings.join(', ')}.` : ''}`;
  const frameHead = [
    `The claim frame for carving ${plan.label} (${plan.conceptId}):`,
    `- What it is: ${input.frame.concept}`,
    `- What the carve is for: ${input.frame.purpose}`,
    `- The range it claims: ${input.frame.range}`,
    '',
    plan.ascent.length ? 'The climb before the carve, nearest broader kind first:' : 'No climb was recorded: the concept was carved before it was located among broader kinds.',
  ];
  const frameTail = input.sema?.length ? ['', `Sema: ${input.sema.join(', ')}.`] : [];
  const frameChunks = [[]]; let frameSize = lines(frameHead).length + lines(frameTail).length;
  plan.ascent.forEach((step, index) => {
    const length = stepLine(step, index).length + 1;
    if (frameChunks.at(-1).length && frameSize + length > 56_000) { frameChunks.push([]); frameSize = 64 + lines(frameTail).length; }
    frameChunks.at(-1).push(index); frameSize += length;
  });
  const frameNotes = frameChunks.map((indexes, chunk) => {
    const last = chunk === frameChunks.length - 1;
    const split = frameChunks.length > 1 ? { chunk: chunk + 1, of: frameChunks.length } : {};
    return {
      nodeId: chunk ? `${prefix}.frame-${chunk + 1}` : `${prefix}.frame`, kind: 'foundation',
      title: clipBytes(`The claim frame and the climb for the carve of ${plan.label}${frameChunks.length > 1 ? `, ${chunk + 1} of ${frameChunks.length}` : ''}`, 300),
      text: lines([...(chunk ? ['The climb before the carve, continued:'] : frameHead), ...indexes.map((index) => stepLine(plan.ascent[index], index)), ...(last ? frameTail : [])]),
      about: bounded([record('concept', plan.conceptId), ...conceptTargets(indexes.map((index) => plan.ascent[index].id)), ...indexes.map((index) => record('abstract_relation', plan.climb[index]))]),
      links: chunk ? [{ relation: 'shaped_by', targetNodeId: `${prefix}.frame` }] : (previous.frame ?? []).map((targetNodeId) => ({ relation: 'supersedes', targetNodeId })),
      data: { schema: CARVE_SCHEMA, part: 'frame', cutId: plan.cutId, conceptId: plan.conceptId, ...split, ...(chunk ? {} : { frame: input.frame }),
        ascent: indexes.map((index) => ({ id: plan.ascent[index].id, label: plan.ascent[index].label })), ...(input.sema?.length && last ? { sema: input.sema } : {}) },
    };
  });
  const frame = frameNotes[0];
  const verdictText = ({ candidate, outcome }) => lines([
    `${candidate.label} (${candidate.key}): ${outcome === 'kind' && candidate.kindOf ? `a kind of ${candidate.kindOf}` : outcome === 'merged' && candidate.mergedInto ? `merged into ${candidate.mergedInto}`
      : outcome === 'routed' && candidate.routedTo ? `routed to ${candidate.routedTo}` : outcome}.`,
    `- What it covers: ${candidate.meaning}`,
    ...TESTS.map((test) => `- ${test[0].toUpperCase()}${test.slice(1)} ${candidate[test].verdict}: ${candidate[test].reason}`),
  ]);
  const { completeness } = input;
  // The verdicts with their reasons, in as many notes as the text needs (a note holds 64,000 characters); the data of
  // each holds the verdicts alone, so nothing long is stored twice.
  const intro = 'Each candidate tested against the frame for necessity, independence and universality, then the parts together for completeness.';
  const closing = `Completeness ${completeness.verdict}: ${completeness.reason}${completeness.checkedAgainst ? ` Checked against ${completeness.checkedAgainst}.` : ''}${completeness.missing?.length ? ` Still without a home: ${completeness.missing.join('; ')}.` : ''}`;
  const chunks = [[]]; let size = intro.length + closing.length;
  for (const item of plan.judged) {
    const length = verdictText(item).length + 2;
    if (chunks.at(-1).length && size + length > 56_000) { chunks.push([]); size = intro.length; }
    chunks.at(-1).push(item); size += length;
  }
  const testNotes = chunks.map((items, index) => {
    const last = index === chunks.length - 1;
    const nodeId = index ? `${prefix}.tests-${index + 1}` : `${prefix}.tests`;
    const own = new Set(items.map(({ candidate }) => candidate.key));
    return {
      nodeId, kind: 'assessment', title: clipBytes(`The four tests for the carve of ${plan.label}${chunks.length > 1 ? `, ${index + 1} of ${chunks.length}` : ''}`, 300),
      text: lines([intro, '', ...items.map((item) => `${verdictText(item)}\n`), ...(last ? [closing] : [])]),
      about: bounded([...cutTarget, ...conceptTargets(plan.parts.filter((part) => own.has(part.key)).map((part) => part.conceptId)),
        ...conceptTargets(plan.kinds.filter((kind) => kind.conceptId && own.has(kind.key)).map((kind) => kind.conceptId))]),
      links: [{ relation: 'shaped_by', targetNodeId: frame.nodeId }, ...(index === 0 ? (previous.tests ?? []).map((targetNodeId) => ({ relation: 'supersedes', targetNodeId })) : [])],
      data: { schema: CARVE_SCHEMA, part: 'tests', cutId: plan.cutId, conceptId: plan.conceptId, ...(chunks.length > 1 ? { chunk: index + 1, of: chunks.length } : {}),
        candidates: items.map(({ candidate, outcome }) => ({ key: candidate.key, label: candidate.label, outcome,
          ...Object.fromEntries(TESTS.map((test) => [test, candidate[test].verdict])), ...(candidate.kindOf ? { kindOf: candidate.kindOf } : {}),
          ...(candidate.mergedInto ? { mergedInto: candidate.mergedInto } : {}), ...(candidate.routedTo ? { routedTo: candidate.routedTo } : {}) })),
        ...(last ? { completeness: { verdict: completeness.verdict, ...(completeness.checkedAgainst ? { checkedAgainst: completeness.checkedAgainst } : {}), ...(completeness.missing?.length ? { missing: completeness.missing } : {}) } } : {}) },
    };
  });
  const routing = input.routing ?? [];
  const { noHome, twoHomes } = plan;
  const named = (items) => items.map((item) => item.label).join(', ');
  const synthesis = {
    nodeId: `${prefix}.synthesis`, kind: 'decision', title: clipBytes(`The carve of ${plan.label}: its parts and how they make it work`, 300),
    text: lines([
      plan.cutRecorded
        ? `${plan.label} is carved into ${plan.parts.length} parts: ${named(plan.parts)}${input.form === 'cut' ? ', the answers of one Cut over a shared pool' : ''}.`
        : plan.kept ? `${plan.label} is kept whole, as a kind of ${plan.ascent[0].label}: ${input.keepWhole.reason}${plan.parts.length ? ` (passed: ${named(plan.parts)})` : ''}`
        : `Fewer than two candidates passed, so ${plan.previousCut ? `the carve of ${plan.label} recorded earlier under ${plan.cutId} stands unchanged` : `${plan.label} has no carve in the model yet`}${plan.parts.length ? ` (passed: ${named(plan.parts)})` : ''}. The verdicts are kept here for the next attempt.`,
      '',
      `How the parts make the whole work: ${input.synthesis}`,
      ...(plan.kinds.length ? ['', `Kinds, not parts (found only in some cases): ${plan.kinds.map((kind) => `${kind.label}${kind.kindOf ? ` (a kind of ${kind.kindOf})` : ''}`).join(', ')}.`] : []),
      ...(plan.frontier.length ? ['', `Frontier alternatives, kept with their verdicts for later evidence: ${plan.frontier.map((item) => `${item.label} (${item.open.join(', ') || 'declared'})`).join(', ')}.`] : []),
      ...(plan.merged.length || plan.routed.length || plan.dropped.length ? [''] : []),
      ...(plan.merged.length ? [`Merged: ${plan.merged.map((item) => `${item.label}${item.mergedInto ? ` into ${item.mergedInto}` : ''}`).join(', ')}.`] : []),
      ...(plan.routed.length ? [`Routed elsewhere: ${plan.routed.map((item) => `${item.label}${item.routedTo ? ` to ${item.routedTo}` : ''}`).join(', ')}.`] : []),
      ...(plan.dropped.length ? [`Dropped: ${named(plan.dropped)}.`] : []),
      ...(routing.length ? ['', `Routing sample: ${routing.length} case(s); ${noHome.length} with no home among the parts${noHome.length ? ` (${noHome.slice(0, 5).map((item) => item.case).join('; ')})` : ''}; ${twoHomes.length} with two or more parts as homes${twoHomes.length ? ` (${twoHomes.slice(0, 5).map((item) => `${item.case}: ${item.partHomes.join(', ')}`).join('; ')})` : ''}.`] : []),
    ]),
    about: bounded([...cutTarget, record('concept', plan.conceptId)]),
    links: [{ relation: 'shaped_by', targetNodeId: frame.nodeId }, ...testNotes.map((note) => ({ relation: 'shaped_by', targetNodeId: note.nodeId })),
      ...(previous.synthesis ?? []).map((targetNodeId) => ({ relation: 'supersedes', targetNodeId }))],
    data: { schema: CARVE_SCHEMA, part: 'synthesis', cutId: plan.cutId, conceptId: plan.conceptId, form: input.form, cutRecorded: plan.cutRecorded,
      parts: plan.parts.map((part) => ({ key: part.key, conceptId: part.conceptId, ...(part.processId ? { processId: part.processId } : {}) })),
      ...(plan.wholeProcess ? { process: plan.wholeProcess } : {}), ...(routing.length ? { routing } : {}) },
  };
  return [...frameNotes, ...testNotes, synthesis];
}

// The notes of the latest earlier carve under the same id (or the one superseded), by part, so the new notes supersede
// them. The latest is the one written at the latest graph revision.
function previousNotes(view, cutIds) {
  const found = {};
  for (const node of view.nodes ?? []) {
    let payload = null;
    try { payload = JSON.parse(node.text); } catch { continue; }
    const data = payload?.data;
    if (data?.schema !== CARVE_SCHEMA || !cutIds.includes(data.cutId) || !['frame', 'tests', 'synthesis'].includes(data.part)) continue;
    const step = Number(node.value_time ?? 0);
    const current = found[data.part];
    if (!current || step > current.step) found[data.part] = { step, ids: [node.id] };
    else if (step === current.step) current.ids.push(node.id);
  }
  return Object.fromEntries(Object.entries(found).map(([part, item]) => [part, item.ids.sort()]));
}

export async function recordCarve(service, raw) {
  const input = carveRecordSchema.parse(raw);
  const { model: stored } = await service.inspectModel({ modelHash: input.previousModelHash, includeDefinition: true });
  const previous = stored.meaning_model ? stored : { ...stored, meaning_model: { schema: MEANING_SCHEMA } };
  const { change, plan } = carveChange(previous, input);
  let revised = null; let summary = null; let revisionNumber = stored.revision?.number ?? null;
  if (change) {
    const applied = applyModelChange(previous, input.previousModelHash, change);
    summary = applied.summary;
    revised = await service.reviseModel({ requestId: input.requestId, previousModelHash: input.previousModelHash, model: applied.successor });
    revisionNumber = applied.successor.revision.number;
  }
  const modelHash = revised?.modelHash ?? input.previousModelHash;
  const open = openTemplates(plan, input);
  const next = [];
  if (plan.kept) next.push(`${plan.label} is kept whole${plan.kept.replaced ? ' (the earlier decision is replaced)' : ''}: the deepen check leaves ${plan.kept.process} out until the Events that move it (${plan.kept.events} now) or its unexplained moves (${plan.kept.unexplained}) grow by half.`);
  else if (!plan.cutRecorded) next.push(`Fewer than two candidates passed the tests, so no carve was recorded${plan.previousCut ? ` and the earlier carve under ${plan.cutId} stands unchanged` : ''}: reframe the claim, look for the parts still missing, and carve again.${plan.parts.length ? ` ${plan.parts.map((part) => part.label).join(', ')} passed.` : ''}`);
  if (input.completeness.verdict !== 'pass') next.push(`Completeness ${input.completeness.verdict === 'fail' ? 'fails' : 'is not yet shown'}: search for what is missing, best against an outside list made by someone else for another purpose, then carve again under the same id.`);
  // What the verdicts and the routing sample say against each other: warnings, never refusals.
  if (plan.noHome.length && input.completeness.verdict === 'pass') next.push(`Completeness is recorded as pass, but ${plan.noHome.length} routed case(s) have no home among the parts, such as ${plan.noHome.slice(0, 2).map((item) => item.case).join('; ')}: find the part they belong to, or reframe the claim, and carve again under the same id.`);
  else if (plan.noHome.length) next.push(`${plan.noHome.length} routed case(s) have no home among the parts, such as ${plan.noHome.slice(0, 2).map((item) => item.case).join('; ')}: each points to a missing part.`);
  const coupled = plan.twoHomes.filter((item) => item.partHomes.every((home) => input.candidates.find((candidate) => candidate.key === home)?.independence.verdict === 'pass'));
  if (coupled.length) next.push(`${coupled.length} routed case(s) belong to two parts whose independence passed, such as ${coupled.slice(0, 2).map((item) => `${item.case} (${item.partHomes.join(', ')})`).join('; ')}: those parts may not vary apart; merge them, redraw the line between them, or say in the verdicts why the case splits cleanly.`);
  if (plan.cutRecorded && !(input.routing ?? []).length) next.push('No routing sample was recorded: send real cases, chosen before the carve and from another source than the candidates, through the parts, and carve again under the same id with them in routing.');
  if (plan.cutRecorded && plan.judged.every((item) => item.outcome === 'part')) next.push('Every candidate became a part: record among the candidates the ones you considered and set aside, with their verdicts, so the carve shows what it was tested against.');
  if (plan.parentCarve) next.push(`${plan.label} is a part in the carve ${plan.parentCarve.id} of ${plan.parentCarve.parent_concept_id}, whose frame is: ${plan.parentCarve.lens}. Check that this carve's frame serves that one.`);
  if (plan.sameLabel.length) next.push(`The climb added ${plan.sameLabel.map((item) => `${item.added} for "${item.step}"`).join(', ')}, while the model already has ${plan.sameLabel.map((item) => item.existing).join(', ')} with that name: if it is the same kind, carve again with the step's id set to the existing one.`);
  if (!input.ascent.length) next.push('Climb before you carve: name the broader kinds this concept belongs to, up to the root, and carve again under the same id.');
  if (plan.kinds.length) next.push(`Kinds are narrower carves, not parts: ${plan.kinds.map((kind) => kind.label).join(', ')}${plan.kinds.some((kind) => !kind.kindOf) ? '. Give each its kindOf, the part it is a kind of' : ''}.`);
  if (plan.frontier.length) next.push(`Frontier alternatives stay recorded with their verdicts: ${plan.frontier.map((item) => item.label).join(', ')}. Later evidence may promote one: carve again with it among the candidates.`);
  if (plan.besides.length) next.push(`${plan.label} has other current carves: ${plan.besides.join(', ')}. They stand beside this one as carves under other lenses; if this one replaces one of them, name it in supersedes.`);
  if (input.form === 'processes' && !plan.wholeProcess) next.push(`Name the process this carve divides (concept.process), so its parts are filed under it and the values report can find the carve.`);
  if (open.length) next.push(input.form === 'cut'
    ? 'Read the parts as one Cut: complete the life_series_record template in open with its subject, the pool, and dated readings.'
    : 'Open the parts: complete each template in open with a measure that passes the number test and dated values, and send them in one life_values_record call. Then carve each part that matters the same way, again and again.');
  next.push('Route new real cases through the carve as they come: a case with no home shows a missing part, one with two homes shows two parts that are not independent.');
  const result = { ...(revised ?? {}), schema: 'meaning-model-carve-record/v1', previousModelHash: input.previousModelHash, modelHash, revisedByChange: Boolean(revised), ...(summary ? { change: summary } : {}),
    carve: { cutId: plan.cutId, conceptId: plan.conceptId, recorded: plan.cutRecorded, ...(input.supersedes && plan.cutRecorded ? { withdrew: input.supersedes } : {}), revised: Boolean(plan.previousCut),
      parts: plan.parts.map(({ candidate, ...part }) => part), kinds: plan.kinds, frontier: plan.frontier, merged: plan.merged, routed: plan.routed, dropped: plan.dropped,
      completeness: input.completeness.verdict, conceptsAdded: plan.createdConcepts, ...(plan.reusedConcepts.length ? { conceptsReused: plan.reusedConcepts } : {}), relationsAdded: plan.relations },
    open, graph: null, next };
  if (!input.graph) {
    next.unshift('No graph was given, so the reasons for each verdict, the frame and the synthesis are not recorded; the cut keeps one short line per verdict. Give graph {graphHash, accessScopes} to record them as notes.');
    return result;
  }
  // The graph: rebound to the revision first, so the notes can name the records it added. Each step has its own request
  // id, and nothing is thrown once the model revision is registered: a failed step says what to call next.
  const scopes = [...new Set(input.graph.accessScopes)].sort();
  let graphHash = input.graph.graphHash;
  if (revised) {
    try {
      // A retry, even after later carves moved the graph on, rebinds from the revision its first attempt rebound (the
      // rebind's own receipt), so the engine returns that first result; a first attempt follows the graph to its head.
      const prior = service.narrativeRevisionReceipt?.(`${input.requestId}:rebind`) ?? null;
      const head = prior ? { graphHash: prior.previousGraphHash } : await resolveAppendHead(service, graphHash, `${input.requestId}:rebind`);
      // A retry of a call that already rebound the graph finds it bound to this revision, which is what was wanted.
      const rebound = await rebindNarrativeGraph(service, { requestId: `${input.requestId}:rebind`, graphHash: head.graphHash, modelHash, accessScopes: scopes, reason: clipBytes(`Carve of ${plan.label}: ${input.reason}`, 4_000) })
        .catch((error) => { if (/already bound to this model/u.test(error.message)) return { graphHash: head.graphHash }; throw error; });
      graphHash = rebound.graphHash;
    } catch (error) {
      return { ...result, partial: true, failure: { stage: 'rebind', message: error.message },
        next: [`The model revision is registered (${modelHash}), but the graph was not rebound: rebind it with life_narrative_rebind to ${modelHash}, then call life_carve_record again with the same input on previousModelHash ${input.previousModelHash} and a new requestId to record the notes, or record them with life_understanding_record.`, ...next] };
    }
  }
  let notes; let written = null; const noteIds = [];
  try {
    // The notes this write supersedes are read from the graph it will be added to: on a retry, the one its first attempt
    // was added to (the receipt says which), so the retry sends the same notes. Earlier attempts that recorded no cut
    // left notes under the same cut id, and they are superseded too.
    const base = await resolveAppendHead(service, graphHash, `${input.requestId}:notes`);
    const baseView = await readGraph(service, base.graphHash, scopes);
    const earlier = previousNotes(baseView, [plan.cutId, ...(input.supersedes ? [input.supersedes] : [])]);
    // Note ids name the attempt as well as the revision: a second attempt that changes nothing in the model has the
    // revision of the first, and an exact retry has the same request id, so it rebuilds the same ids.
    const attempt = createHash('sha256').update(input.requestId).digest('hex').slice(0, 10);
    // Every note of one carve carries the graph revision it was begun at, also when it is written in a later batch, so
    // the next carve finds and supersedes all of them.
    const valueTime = Number(baseView.graph?.revision?.number ?? 0);
    notes = carveNotes(plan, input, { prefix: `note.${plan.cutId}.r${revisionNumber}.${attempt}`, previous: earlier }).map((note) => ({ ...note, valueTime }));
    // One write holds 512 KiB: a large carve is written in batches, each with its own request id, so a replay of the
    // same call finds the batches already written and writes the rest.
    let at = graphHash;
    for (const [index, batch] of noteBatches(notes).entries()) {
      written = await recordUnderstanding(service, { graphHash: at, requestId: index ? `${input.requestId}:notes-${index + 1}` : `${input.requestId}:notes`, accessScopes: scopes, holder: input.holder, notes: batch });
      at = written.graphHash; noteIds.push(...written.nodeIds);
    }
    return { ...result, graph: { graphHash: written.graphHash, previousGraphHash: input.graph.graphHash, rebound: Boolean(revised), noteIds, understandingRootId: written.understandingRootId } };
  } catch (error) {
    const failed = { ...result, partial: true, failure: { stage: 'notes', message: error.message }, graph: { graphHash: written?.graphHash ?? graphHash, previousGraphHash: input.graph.graphHash, rebound: Boolean(revised), noteIds },
      next: [`The model revision is registered and the graph rebound, but ${noteIds.length ? 'not all of the notes were recorded' : 'the notes were not recorded'}: call life_carve_record again with exactly the same input, requestId ${input.requestId} included. It returns the stored revision and records what is missing.`, ...next] };
    // The notes to send by hand as well, while they fit in the result the tool declares; otherwise the replay alone.
    const withRetry = notes && !noteIds.length ? { ...failed, retry: { tool: 'life_understanding_record', arguments: { graphHash, requestId: `${input.requestId}:notes-retry`, accessScopes: scopes, holder: input.holder, notes } } } : null;
    return withRetry && JSON.stringify(withRetry).length <= RETRY_RESULT_CHARACTERS && Buffer.byteLength(JSON.stringify(withRetry.retry.arguments)) <= NOTE_BATCH_BYTES ? withRetry : failed;
  }
}

// What one note write may hold, under the 512 KiB an understanding record allows, and the most a failed carve's result
// carries with the notes to send by hand (the tool declares 500,000 characters).
const NOTE_BATCH_BYTES = 400 * 1024;
const RETRY_RESULT_CHARACTERS = 450_000;
function noteBatches(notes) {
  const batches = [[]]; let size = 0;
  for (const note of notes) {
    const bytes = Buffer.byteLength(JSON.stringify(note));
    if (batches.at(-1).length && size + bytes > NOTE_BATCH_BYTES) { batches.push([]); size = 0; }
    batches.at(-1).push(note); size += bytes;
  }
  return batches;
}

export const carveRecordDescription = 'Record one conceptual decomposition as one step: the claim frame (what the concept is, what the carve is for, the range it claims), the climb to the root (each broader kind, what sets the kind below apart, its other kinds), every candidate part with its necessity, independence and universality verdicts and reasons, the completeness of the set (best checked against an outside list), real cases routed through it, and how the parts make the whole work. A candidate passing all three tests is a part; one failing only universality is a kind under a part (kindOf), not a part; one uncertain stays a frontier alternative; merged, routed and dropped are kept too. The model gets one revision: the concepts it lacks (it never edits existing ones), the kind-of relations of the climb, and an abstract cut from the concept to its parts (two or more), whose provenance names the process it divides (divides-process:<id>), the process of each part (part:<concept>=<process>) and one line per verdict; carving the same concept again under the same cutId revises the carve, and supersedes withdraws another. When no carve pays, keepWhole records that the process stays whole, the answer to the deepen check in the values report. With graph {graphHash, accessScopes}, the graph is rebound to the revision and three notes held by holder record the frame and climb, the four tests with every reason, and the synthesis, linked to those records and superseding the notes of the carve they revise. The parts are not opened here: open lists a life_values_record template for each part still to open, file or move (or a life_series_record template for form cut), with what each still needs, a measure that passes the number test and dated values. The values report then names processes divided without a recorded carve, parts not yet opened, and parts filed under a carved process without being tested. Sema is optional; cite patterns used in sema.';

export function registerCarveTools(server, service, { toolResult }) {
  server.registerTool('life_carve_record', {
    description: carveRecordDescription,
    inputSchema: carveRecordSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await recordCarve(service, input)));
}
