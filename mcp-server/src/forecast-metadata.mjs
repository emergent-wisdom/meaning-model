// Forecasts use ordinary Cut provenance. This declaration binds probabilities to the exact outcomes and time window
// that were issued; a caller's new window cannot change what an older probability means.
export const FORECAST_METADATA_MARK = 'meaning-model-forecast/v1';
// A forecast line that says its weights are probabilities, in the documented words, with a note after them, or in the
// agent's own words. Only an explicit denial ("not probabilities", "shares rather than probabilities") is refused:
// a guessed forecast is still a forecast, and the method wants it recorded. A denial must be about the probabilities
// themselves, so a note such as "not yet settled" or an outcome such as "no sale" does not undo the declaration.
const forecastLine = /^\s*forecast\b/iu;
const term = String.raw`(?:probabilit\w*|chances?|likelihoods?)`;
const mentionsProbability = new RegExp(String.raw`\b${term}`, 'iu');
// "Chance" names outcomes too ("no chance of an early sale"), so only probability and likelihood can be denied.
const denied = String.raw`(?:probabilit\w*|likelihoods?)`;
const filler = String.raw`(?:a|an|the|any|real|true|actual|actually|explicitly|meant|intended|declared|stated|given|to|be|being|read|as)`;
const deniedBefore = new RegExp(String.raw`(?:\b(?:not|no|never|without|rather\s+than|instead\s+of)|n't)\s+(?:${filler}\s+){0,5}${denied}`, 'iu');
const deniedAfter = new RegExp(String.raw`\b${denied}\s+(?:(?:are|is|were|was)\s+)?(?:undeclared|unknown|(?:not|never|\w+n't)\s+(?:(?:yet|actually|explicitly|being)\s+){0,3}(?:declared|stated|given|provided|assigned|specified|known))\b`, 'iu');
const nonProbabilistic = /\bnon-?probabil/iu;
const affirms = (entry) => {
  const words = entry.replace(/[‘’ʼ＇]/gu, "'").replace(/[‐‑‒–—]/gu, '-');
  return forecastLine.test(words) && mentionsProbability.test(words)
    && !deniedBefore.test(words) && !deniedAfter.test(words) && !nonProbabilistic.test(words);
};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const numericToken = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
const annotatedNumber = new RegExp(String.raw`^(${numericToken})\s*\([^()]*\)$`, 'iu');
const completeNumbers = new RegExp(String.raw`(?<![\p{L}\p{N}_.+\-])${numericToken}(?![\p{L}\p{N}_.+\-])`, 'giu');
const modelTime = (text) => {
  // A parenthesized date may repeat the same time in another notation. Otherwise there must be exactly one complete
  // numeric token: "hour 7" is clear, but "7 or 8" and malformed numbers such as "2.025e" cannot bind a window.
  const normalized = text.replace(/−/gu, '-');
  const annotation = normalized.match(annotatedNumber);
  const values = annotation ? [annotation[1]] : normalized.match(completeNumbers) ?? [];
  return values.length === 1 && finite(Number(values[0])) ? Number(values[0]) : null;
};
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const outcomes = (answers) => [...(answers ?? [])].sort((a, b) => a.key.localeCompare(b.key));

export function forecastMetadata(cut) {
  const provenance = (cut?.provenance ?? []).map(String);
  const entries = provenance.filter((entry) => entry.startsWith(`${FORECAST_METADATA_MARK} `));
  const declared = provenance.some(affirms);
  if (entries.length) {
    if (entries.length !== 1) return { declared, binding: null, invalid: true, problem: 'The forecast has more than one metadata declaration.' };
    let data;
    try { data = JSON.parse(entries[0].slice(FORECAST_METADATA_MARK.length + 1)); } catch { return { declared, binding: null, invalid: true, problem: 'The forecast metadata is not valid JSON.' }; }
    if (data?.probabilities !== true || !finite(data.cutoff) || !finite(data.window?.start) || !finite(data.window?.end)
      || data.window.start < data.cutoff || data.window.end < data.window.start || typeof data.settledBy !== 'string' || !data.settledBy.trim()
      || typeof data.question !== 'string' || typeof data.unit !== 'string' || !Array.isArray(data.answers)) {
      return { declared, binding: null, invalid: true, problem: 'The forecast metadata must declare probabilities, cutoff, window, settlement and exact question, unit and answers.' };
    }
    if (data.question !== cut.question || data.unit !== cut.unit || canonical(outcomes(data.answers)) !== canonical(outcomes(cut.answers))) {
      return { declared: true, binding: null, invalid: true, problem: 'The forecast Cut no longer matches the question, unit and answers frozen in its metadata.' };
    }
    return { declared: true, binding: { cutoff: data.cutoff, window: { ...data.window }, question: data.question, unit: data.unit,
      answers: structuredClone(data.answers), settledBy: data.settledBy, source: 'metadata' }, problem: null };
  }
  if (!declared) return { declared: false, binding: null, problem: null };
  // The documented convention: an evidence cutoff and a horizon in model time, with optional prose annotations.
  // A settlement rule is needed for scoring, not for branching.
  const number = (prefix) => {
    const values = provenance.filter((entry) => entry.toLowerCase().startsWith(prefix)).map((entry) => entry.slice(prefix.length).trim());
    if (values.length !== 1) return null;
    return modelTime(values[0]);
  };
  const cutoff = number('evidence cutoff:'), horizon = number('horizon:');
  const settlements = provenance.filter((entry) => entry.toLowerCase().startsWith('settled by:')).map((entry) => entry.slice('settled by:'.length).trim()).filter(Boolean);
  if (cutoff === null || horizon === null || horizon < cutoff) {
    return { declared: true, binding: null, problem: 'The forecast does not state its own evidence cutoff and horizon in model time, so the window it speaks of is the one given when forking. Record them with the forecast (evidence cutoff: <time>, horizon: <time>) to bind its probabilities.' };
  }
  return { declared: true, binding: { cutoff, window: { start: cutoff, end: horizon }, question: cut.question, unit: cut.unit,
    answers: structuredClone(cut.answers), settledBy: settlements[0] ?? null, source: 'provenance' },
    problem: settlements.length ? null : 'The forecast does not say what will settle it; record that before it can be scored.' };
}

export const declaredForecast = (cut) => forecastMetadata(cut).declared;
