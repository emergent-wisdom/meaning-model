// The mark life_series_record puts on the Events it makes to carry readings. Such an Event is a stretch of a subject's
// life that holds a reading, not something that happened: views draw it as the curve, not as an Event, and the open
// questions do not count it among what happens in a life.
export const SERIES_EVENT_MARK = 'Meaning Model series reading v1';
export const isSeriesReadingEvent = (event) => (event?.provenance ?? []).includes(SERIES_EVENT_MARK);

// The mark on a reading Event whose shares its author declares steady across the whole stretch, with the reason in its
// why. In the time schedule a steady reading covers every finer block inside it, so nothing finer is asked for there;
// the open questions still ask about a stretch of a life where the subject's own Events happen.
export const STEADY_MARK = 'Meaning Model steady reading v1';
export const isSteadyReading = (event) => (event?.provenance ?? []).includes(STEADY_MARK);
