// A viewing window is presentation, never a new model interval or value sample.
export const isCalendarTime = (unit) => unit === 'year' || unit === 'years' || String(unit ?? '').startsWith('civil_day_since_1970');
export const nativeTimeText = (value, unit) => `${Number(value.toPrecision(8)).toLocaleString('en-GB', { maximumSignificantDigits: 8 })} ${unit}`;

const DAY_MS = 86400000;
const DISPLAY_YEAR_DAYS = 365.2425;
const civilDays = (unit) => String(unit ?? '').startsWith('civil_day_since_1970');
function utcDate(year, month = 0, day = 1) {
  const date = new Date(0); date.setUTCFullYear(year, month, day); date.setUTCHours(0, 0, 0, 0); return date;
}

// The data adapter's civil-day coordinate is 1970 + days/365.2425, not a
// fraction measured from January 1 of floor(t). Invert that exact encoding.
// Rounding milliseconds prevents a floating-point midnight becoming yesterday.
export function calendarDateOf(time, unit) {
  if (civilDays(unit)) return new Date(Math.round((time - 1970) * DISPLAY_YEAR_DAYS * DAY_MS));
  const year = Math.floor(time);
  return new Date(Math.round(utcDate(year).getTime() + (time - year) * DISPLAY_YEAR_DAYS * DAY_MS));
}

export function calendarTimeOf(date, unit) {
  if (civilDays(unit)) return 1970 + date.getTime() / DAY_MS / DISPLAY_YEAR_DAYS;
  const year = date.getUTCFullYear();
  return year + (date.getTime() - utcDate(year).getTime()) / (DISPLAY_YEAR_DAYS * DAY_MS);
}

export const calendarTickAt = (year, month, day, unit) => calendarTimeOf(utcDate(year, month, day), unit);

export function numericTimeTicks(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
  const rough = (end - start) / 8; const scale = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((size) => size * scale >= rough) ?? 10) * scale;
  const first = Math.ceil(start / step) * step;
  return Array.from({ length: Math.min(32, Math.max(0, Math.floor((end - first) / step + 1e-9) + 1)) }, (_, index) => +(first + index * step).toPrecision(12));
}

export function temporalWindow(data) {
  if (!String(data.timeUnit ?? '').trim()) return null;
  const calendar = isCalendarTime(data.timeUnit);
  const plotted = (calendar ? data.measures ?? [] : []).filter((measure) => measure.points?.length >= 2)
    .flatMap((measure) => measure.points.map((point) => point.t)).filter(Number.isFinite);
  const story = data.storyWindow ?? data.window;
  if (plotted.length) {
    const from = Number.isFinite(data.display?.from) ? data.display.from : Number.isFinite(story?.start) ? story.start - 0.4 : -Infinity;
    const start = Math.max(Math.min(...plotted), from); const end = Math.max(...plotted) + 0.12;
    if (Number.isFinite(start) && start < end) return { start, end, source: 'samples' };
  }
  const events = (data.events ?? []).filter((event) => ['accepted_world', 'inner', 'unrooted', undefined].includes(event.context) && Number.isFinite(event.start));
  if (!events.length) return null;
  // Story placement is already resolved from declared Event links by the data
  // adapter. Its range is a useful camera window, not an interval for every node.
  const storyRange = Number.isFinite(story?.start) && Number.isFinite(story?.end) && story.start <= story.end;
  const start = storyRange ? story.start : Math.min(...events.map((event) => event.start));
  const end = storyRange ? story.end : Math.max(...events.map((event) => Number.isFinite(event.end) ? event.end : event.start));
  const pad = start === end ? (calendar ? 0.12 : 0.5) : Math.max(Number.EPSILON, (end - start) * 0.02);
  return { start: start - pad, end: end + pad, source: 'events' };
}
