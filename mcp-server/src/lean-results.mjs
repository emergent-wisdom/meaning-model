// Results of writes repeat parts that do not change from one call to the next. An agent's context carries every result
// to the end of its session, so a repeated part costs again at every later step. Two kinds are shortened here, at the
// tool layer, and nothing else in a result is touched:
//
// - Fixed guidance attached to the open questions (the standing questions, the scope note, the guidance): the first
//   time this server process sends a given text it goes in full; a later identical copy becomes a pointer to the read
//   that returns it. Changed text is always sent in full. The server cannot know whether the agent's context still
//   holds what it sent: a client can compact or summarize it at any time. So every pointer says how long ago the full
//   text was sent and tells the agent to call life_context_reset, which returns it, if it does not have it now; and
//   the full text also goes out again after four pointers, and on the next write after any read with which an agent
//   starts its work over (REORIENTING_TOOLS).
// - The importance report: the scales a call touched keep their full report; the others keep their counts. Every hint
//   about what is still unjudged stays.
//
// The model's open questions, warnings, refusals, blocking changes, hashes and change counts are never shortened.
// MEANING_MODEL_LEAN_RESULTS=off restores the complete results.
import { createHash } from 'node:crypto';

// What this server process has delivered: how many results and characters in all, and for each fixed text, where those
// counts stood when it last went in full and how many pointers have gone out since; and, for life_context_reset, the
// most recent copy of each part with the model it came with.
let resultsSent = 0;
let charactersSent = 0;
const sent = new Map();
const latest = new Map();
export const leanResultsEnabled = (environment = process.env) => String(environment.MEANING_MODEL_LEAN_RESULTS ?? 'on').trim().toLowerCase() !== 'off';
export const FIXED_OPEN_QUESTION_PARTS = Object.freeze(['alwaysAsk', 'scope', 'guidance']);
export const POINTERS_BEFORE_RESEND = 4;
export const REPEAT_POINTER_START = 'Sent in full by this server';
export const isRepeatPointer = (value) => typeof value === 'string' && value.startsWith(REPEAT_POINTER_START);
const keyOf = (part, value) => `${part}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const pointer = (since) => {
  const results = resultsSent - since.results;
  const thousands = Math.round((charactersSent - since.characters) / 1000);
  return `${REPEAT_POINTER_START} ${results} result${results === 1 ? '' : 's'} and about ${thousands}k characters ago, and unchanged since. `
    + 'If it is not in your context now, for example because your context was compacted or summarized, call life_context_reset, which returns it; life_model_questions also returns it in full.';
};

// What a result will send, recording nothing: a result that is never delivered must not count as sent.
export function planLeanResult(value) {
  const plan = { value, steps: [], modelHash: typeof value?.modelHash === 'string' ? value.modelHash : null };
  if (!leanResultsEnabled() || !value || typeof value !== 'object' || Array.isArray(value)) return plan;
  const open = value.openQuestions;
  if (!open || typeof open !== 'object' || Array.isArray(open)) return plan;
  let shortened = null;
  for (const part of FIXED_OPEN_QUESTION_PARTS) {
    if (open[part] === undefined || isRepeatPointer(open[part])) continue;
    const key = keyOf(part, open[part]);
    const since = sent.get(key);
    const full = !since || since.pointers >= POINTERS_BEFORE_RESEND;
    plan.steps.push({ part, key, full, text: open[part] });
    if (full) continue;
    shortened ??= { ...open };
    shortened[part] = pointer(since);
  }
  if (shortened) plan.value = { ...value, openQuestions: shortened };
  return plan;
}

// Record a delivered result: its size, so that pointers can say how far back a full text is, and what it sent of each
// fixed text. With guidance false the result reached the client without its text, so its guidance is not counted as
// seen and goes in full next time.
export function commitLeanResult(plan, characters, { guidance = true } = {}) {
  if (guidance) {
    for (const step of plan.steps) {
      const since = sent.get(step.key);
      if (step.full || !since) sent.set(step.key, { pointers: 0, results: resultsSent, characters: charactersSent });
      else since.pointers += 1;
      latest.set(step.part, { text: step.text, modelHash: plan.modelHash });
    }
  }
  resultsSent += 1;
  charactersSent += Number.isFinite(characters) ? characters : 0;
}

// Plan and record at once, for a result known to be delivered with its text.
export function leanRepeats(value, characters = 0) {
  const plan = planLeanResult(value);
  commitLeanResult(plan, characters);
  return plan.value;
}

// The agent's own reset, for when its context was compacted or summarized or it is unsure what it still holds: the most
// recent copy of each fixed part comes back now, with the models it came with, and counts as sent now. Other copies go
// in full when next due.
export function resetContext() {
  const parts = {};
  const models = new Set();
  for (const part of FIXED_OPEN_QUESTION_PARTS) {
    const last = latest.get(part);
    if (!last) continue;
    parts[part] = last.text;
    if (last.modelHash) models.add(last.modelHash);
  }
  sent.clear();
  for (const [part, text] of Object.entries(parts)) sent.set(keyOf(part, text), { pointers: 0, results: resultsSent, characters: charactersSent });
  return { parts, modelHashes: [...models] };
}

// Reads with which an agent starts or resumes its work, often after its context was compacted: after one, the next
// write sends its fixed guidance in full. Reading one region of the outline is not a new start.
export const REORIENTING_TOOLS = Object.freeze({
  life_modeling_context: () => true,
  life_saved_work_list: () => true,
  life_construction_replay: () => true,
  life_construction_import: () => true,
  life_model_outline: (input) => !input?.focusEventId,
});
export function afterReorienting(name, input) {
  if (REORIENTING_TOOLS[name]?.(input)) sent.clear();
}

// Forget what this process has sent, so each fixed text goes in full next time.
export function forgetSentRepeats() { sent.clear(); latest.clear(); }

export function leanImportanceReport(report, touchedScaleIds) {
  if (!leanResultsEnabled() || !report || !Array.isArray(report.scales)) return report;
  const touched = new Set(touchedScaleIds);
  const others = report.scales.filter((scale) => !touched.has(scale.scale));
  if (!others.length) return report;
  return { ...report, scales: report.scales.filter((scale) => touched.has(scale.scale)),
    otherScales: others.map(({ scale, judged, unjudgedCount }) => ({ scale, judged, ...(unjudgedCount ? { unjudgedCount } : {}) })),
    otherScalesNote: 'Scales this call did not touch, with their counts; life_meaning_query with collections importance_scales and event_importance reads them whole.' };
}
