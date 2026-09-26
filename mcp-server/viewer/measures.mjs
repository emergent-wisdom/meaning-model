// A process's support states its path in words, as the agent authored it: "0 before June 2020; 0.5 by autumn 2020;
// 0.85 through 2021; 0.9 on 9-13 May 2022". readPath turns that into dated display samples in decimal years.
// Keep the source words and how each value and date were obtained: these are parsed samples, not measurements.
// A segment without a date sits between its neighbours; one without a number is skipped.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASONS = { spring: 0.3, summer: 0.55, autumn: 0.8, fall: 0.8, winter: 0.02 };
const PART = { early: 0.15, mid: 0.5, late: 0.85 };
const DATE = new RegExp([
  String.raw`(?:(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s+)?(early|mid|late)?-?\s*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?`,
  String.raw`\b(spring|summer|autumn|fall|winter)\s+(\d{4})`,
  String.raw`\b(\d{4})\s+(spring|summer|autumn|fall|winter)`,
  String.raw`\b(early|mid|late)\s+(\d{4})`,
  String.raw`\b(1[89]\d{2}|20\d{2})\b`,
].join('|'), 'gi');

function datesIn(text) {
  const found = [];
  for (const m of text.matchAll(DATE)) {
    if (m[3]) {
      const day = m[1] ? Number(m[1]) : null; const month = MONTHS.indexOf(m[3].toLowerCase().slice(0, 3));
      const within = day ? (day - 0.5) / 30.5 : PART[m[2]?.toLowerCase()] ?? 0.5;
      found.push({ year: m[4] ? Number(m[4]) : null, offset: (month + within) / 12, bare: false });
    } else if (m[5]) found.push({ year: Number(m[6]), offset: SEASONS[m[5].toLowerCase()], bare: false });
    else if (m[7]) found.push({ year: Number(m[7]), offset: SEASONS[m[8].toLowerCase()], bare: false });
    else if (m[9]) found.push({ year: Number(m[10]), offset: PART[m[9].toLowerCase()], bare: false });
    else if (m[11]) found.push({ year: Number(m[11]), offset: 0.5, bare: true });
  }
  return found;
}

const number = (text) => Number(String(text).replace(/,/g, '').replace(/−/g, '-'));
const VALUE = String.raw`([+−-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))`;
const LEAD = new RegExp(String.raw`^(?:about|around|roughly|some|~)?\s*${VALUE}(?:\s*(?:[-–—]|to)\s*${VALUE})?`, 'i');

export function readPath(support) {
  const body = String(support ?? '').replace(/^[^:]*:\s*/, '');
  const points = []; let lastYear = null;
  for (const raw of body.split(';').map((part) => part.trim()).filter(Boolean)) {
    const segment = raw.replace(/\([^)]*\)/g, ' ');
    const lead = segment.match(LEAD);
    const range = lead?.[2] === undefined ? null : [number(lead[1]), number(lead[2])];
    const value = lead ? (range ? (range[0] + range[1]) / 2 : number(lead[1])) : /\b(founded|opened|started|begins?)\b/i.test(segment) ? 0 : null;
    if (value === null || !Number.isFinite(value)) continue;
    const rest = lead ? segment.slice(lead[0].length) : segment;
    const dates = datesIn(rest);
    const sample = { v: value, text: raw, valueSource: range ? 'range_midpoint' : lead ? 'parsed' : 'inferred_zero',
      dateSource: !dates.length || dates.some((date) => date.year === null) ? 'inferred' : 'parsed', ...(range ? { range } : {}) };
    // A month without a year takes the next year named in the segment, else the last one seen.
    for (let i = 0; i < dates.length; i += 1) if (dates[i].year === null) dates[i].year = dates.slice(i + 1).find((d) => d.year !== null)?.year ?? lastYear;
    const times = dates.filter((d) => d.year !== null).map((d) => {
      if (d.bare && /\b(by|until|before)\b/i.test(rest)) return d.year;
      if (d.bare && /\bafter\b/i.test(rest)) return d.year + 1;
      return d.year + d.offset;
    });
    if (times.length) lastYear = Math.floor(times.at(-1));
    if (!times.length) { points.push({ ...sample, t: null, dateSource: 'inferred' }); continue; }
    const bareSpan = dates.length === 1 && dates[0].bare;
    if (/\bfrom\b/i.test(rest) && times.length >= 2) { points.push({ ...sample, t: times[0] }, { ...sample, t: times.at(-1) }); continue; }
    if (times.length >= 2 && dates.every((d) => d.bare)) { points.push({ ...sample, t: dates[0].year + 0.05 }, { ...sample, t: dates.at(-1).year + 0.95 }); continue; }
    if (/\bthrough\b/i.test(rest) && bareSpan) { points.push({ ...sample, t: dates[0].year + 0.05 }, { ...sample, t: dates[0].year + 0.95 }); continue; }
    let t = times[0];
    if (/\b(until|before)\b/i.test(rest)) t -= 0.01; else if (/\bafter\b/i.test(rest) && !bareSpan) t += 0.02;
    points.push({ ...sample, t });
  }
  // Undated segments sit between their dated neighbours, or a quarter-year after the last one.
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].t !== null) continue;
    const before = points.slice(0, i).reverse().find((p) => p.t !== null); const after = points.slice(i + 1).find((p) => p.t !== null);
    points[i].t = before && after ? (before.t + after.t) / 2 : before ? before.t + 0.25 : after ? after.t - 0.25 : null;
  }
  return points.filter((p) => p.t !== null).sort((a, b) => a.t - b.t);
}
