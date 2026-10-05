// The mark life_series_record puts on the Events it makes to carry readings. Such an Event is a stretch of a subject's
// life that holds a reading, not something that happened: views draw it as the curve, not as an Event, and the open
// questions do not count it among what happens in a life.
export const SERIES_EVENT_MARK = 'Meaning Model series reading v1';
export const isSeriesReadingEvent = (event) => (event?.provenance ?? []).includes(SERIES_EVENT_MARK);
