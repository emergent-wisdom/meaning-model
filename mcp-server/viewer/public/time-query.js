// A stretch of time typed into search, read in the model's own clock. A calendar clock (decimal years, or civil days
// since 1970) takes years, ranges, decades, centuries, millennia and "years ago", labelled as the views label them: year
// -500 is 500 BCE, and "years ago" counts back from the model's present. Any other clock takes numbers and ranges of its
// own unit and never calls them years. The whole query must be a time; anything else is left to the record search.
import { calendarTickAt, isCalendarTime } from './temporal-layout.js';

const ERA = '(bce|bc|ce|ad)';
const NUMBER = '(\\d{1,3}(?:[,\\s_]\\d{3})+|\\d+(?:\\.\\d+)?)';
const SCALE = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, billion: 1e9 };
const ORDINAL = '(\\d+)(?:st|nd|rd|th)';
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const yearText = (year) => (year < 0 ? `${grouped(-year)} BCE` : year === 0 ? '1 CE' : `${year}`);
const numberOf = (text) => Number(String(text).replace(/[,\s_]/gu, ''));

function clean(text) {
  return String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
    .replace(/[–—−]/gu, '-').replace(/\s+/gu, ' ')
    .replace(/^(?:go to |show |from |in |the |between |during )+/u, '').replace(/[.?!]$/u, '').trim();
}

// One calendar year, signed: "1914", "500 bce", "ad 800", "800 ce".
function year(text) {
  const t = text.trim();
  let m = new RegExp(`^${ERA} ${NUMBER}$`, 'u').exec(t);
  if (m) return m[1] === 'bc' || m[1] === 'bce' ? -numberOf(m[2]) : numberOf(m[2]);
  m = new RegExp(`^${NUMBER}(?: ?${ERA})?$`, 'u').exec(t);
  if (!m) return null;
  const n = numberOf(m[1]);
  return m[2] === 'bc' || m[2] === 'bce' ? -n : n;
}

// "30,000 years ago", "10 thousand years ago", "2.5 million years ago".
function ago(text, present) {
  const m = new RegExp(`^${NUMBER} ?(thousand|million|billion|k|m)? years? ago$`, 'u').exec(text.trim());
  if (!m || !Number.isFinite(present)) return null;
  return present - numberOf(m[1]) * (SCALE[m[2]] ?? 1);
}

// A calendar span [start, end) in years, with its label, or null.
function calendarSpan(text, present) {
  // A decade or a century written as its years: "1990s" (ten years), "1800s" (a hundred).
  let m = /^(\d{3,4})0s$/u.exec(text);
  if (m) {
    const start = Number(`${m[1]}0`);
    return start % 100 === 0 ? { start, end: start + 100, label: `the ${start}s` } : { start, end: start + 10, label: `the ${start}s` };
  }
  // "19th century", "5th century bce", "2nd millennium".
  m = new RegExp(`^${ORDINAL} (century|centuries|millennium|millennia)(?: ${ERA})?$`, 'u').exec(text);
  if (m) {
    const n = Number(m[1]), size = m[2].startsWith('cent') ? 100 : 1000, bce = m[3] === 'bce' || m[3] === 'bc';
    if (n < 1) return null;
    const span = bce ? { start: -n * size, end: -(n - 1) * size } : { start: (n - 1) * size, end: n * size };
    return { ...span, label: `the ${m[1]}${text.slice(m[1].length).split(' ')[0]} ${size === 100 ? 'century' : 'millennium'}${bce ? ' BCE' : ''}` };
  }
  // A range: "1914-1945", "1914 to 1945", "300 bce to 100 ce", "30,000 years ago to 10,000 years ago".
  const parts = text.split(/\s*(?:-|\bto\b|\buntil\b|\band\b|\bthrough\b)\s*/u).filter(Boolean);
  if (parts.length === 2) {
    // Each end is a moment "years ago" (labelled as typed) or a calendar year (labelled as the views label years).
    const ends = parts.map((part) => {
      const before = ago(part, present);
      return before !== null ? { t: before, label: part, year: false } : { t: year(part), label: null, year: true };
    });
    // "500-300 bce": an era written once, after the second year, belongs to both.
    if (/\b(bce|bc)$/u.test(parts[1]) && !/\b(bce|bc|ce|ad)\b/u.test(parts[0]) && ends[0].year && ends[0].t > 0) ends[0].t = -ends[0].t;
    if (ends.every((end) => end.t !== null)) {
      const [first, last] = ends[0].t <= ends[1].t ? ends : [ends[1], ends[0]];
      const label = (end) => end.label ?? yearText(end.t);
      // A year named as an end is included whole: 1914 to 1945 runs to the end of 1945.
      return { start: first.t, end: last.t + (last.year && Number.isInteger(last.t) ? 1 : 0), label: `${label(first)} to ${label(last)}` };
    }
  }
  // A single moment "years ago" is shown with a tenth of its distance on either side: that far back, a year is nothing.
  const before = ago(text, present);
  if (before !== null) { const reach = (present - before) * 0.1; return { start: before - reach, end: before + reach, label: `about ${text}` }; }
  const single = year(text);
  if (single !== null) return { start: single, end: single + 1, label: yearText(single) };
  return null;
}

// A span in a clock that is not a calendar: "12", "12-40", "12 to 40", in the clock's own unit.
function nativeSpan(text, unit) {
  const value = (part) => (new RegExp(`^-?${NUMBER}$`, 'u').test(part.trim()) ? Number(part.trim().replace(/[,\s_]/gu, '')) : null);
  const parts = text.split(/\s+(?:to|until|and|through)\s+|(?<=\d)\s*-\s*(?=-?\d)/u).filter(Boolean);
  const unitText = String(unit ?? '').trim();
  if (parts.length === 2) {
    const [a, b] = parts.map(value);
    if (a !== null && b !== null) { const [start, end] = a <= b ? [a, b] : [b, a]; return { start, end, label: `${start} to ${end}${unitText ? ` ${unitText}` : ''}` }; }
  }
  const single = value(text);
  return single === null ? null : { start: single, end: single, label: `${single}${unitText ? ` ${unitText}` : ''}` };
}

// { start, end, label } in model time, or null. `present` is the model's present, for "years ago".
export function parseTimeQuery(query, { unit, present } = {}) {
  const text = clean(query);
  if (!text || !/\d/u.test(text)) return null;
  if (!isCalendarTime(unit)) return nativeSpan(text, unit);
  const span = calendarSpan(text, present);
  if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end)) return null;
  // Decimal years are the model's time as written; civil days convert through the same calendar the views draw with.
  const civil = !(unit === 'year' || unit === 'years');
  const toModel = (t) => (civil && Number.isInteger(t) ? calendarTickAt(t, 0, 1, unit) : t);
  return { start: toModel(span.start), end: toModel(span.end), label: span.label };
}
