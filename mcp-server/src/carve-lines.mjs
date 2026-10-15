// The provenance lines that link a carve, or a decision to keep a process whole, to the processes it names. They live
// apart from carve-index.mjs so the scoped reading of a model (model-questions.mjs) can strip them without a cycle.
export const CARVE_MARK = 'life_carve_record';
export const DIVIDES_LINE = 'divides-process:';
export const PART_LINE = 'part:';
// A decision to keep a process whole (life_carve_record with keepWhole), and the signals it was taken with (deepen.mjs).
export const KEPT_WHOLE_LINE = 'kept-whole-process:';
export const KEPT_SIGNALS_LINE = 'kept-whole-signals:';

// The process a carve or kept-whole line names, or null for any other line.
export function processOfLine(line) {
  if (typeof line !== 'string') return null;
  if (line.startsWith(DIVIDES_LINE)) return line.slice(DIVIDES_LINE.length).trim() || null;
  if (line.startsWith(KEPT_WHOLE_LINE)) return line.slice(KEPT_WHOLE_LINE.length).trim() || null;
  if (line.startsWith(PART_LINE)) { const body = line.slice(PART_LINE.length); const at = body.lastIndexOf('='); return at > 0 ? body.slice(at + 1).trim() || null : null; }
  return null;
}
