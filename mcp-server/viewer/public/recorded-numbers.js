import { isPlaybackVisible } from './playback-time.js';

const PALETTE = ['#ffb057', '#58b4ff', '#5fd39a', '#c69bff', '#ff7aa8', '#e8e27a', '#7fe0e6'];
export const readingNeedsReview = (cut) => ['needs_review', 'unresolved'].includes(cut.evidence?.status);
export function answerColor(key) {
  if (key === 'remainder') return '#77746c';
  let hash = 0;
  for (const character of String(key)) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

// Only complete recorded compositions are drawn. No interpolation, held-last
// values, inferred dates or multiplication through conditional denominators.
export function recordedCutSegments(cut) {
  let offset = 0;
  return (cut.answers ?? []).map((answer) => {
    const segment = { key: answer.key, weight: answer.weight, start: offset, end: offset + answer.weight, color: answerColor(answer.key) };
    offset = segment.end;
    return segment;
  });
}

export function visibleRecordedCuts(cuts, clock = {}, { enabled = true, drawnCutIds = new Set() } = {}) {
  if (!enabled) return [];
  return (cuts ?? []).filter((cut) => Number.isFinite(cut.t) && cut.displayable !== false && !cut.withdrawn && !cut.record?.withdrawn && !drawnCutIds.has(cut.id)
    && isPlaybackVisible(cut.t, { ...clock, born: cut.born?.at ? Date.parse(cut.born.at) : -Infinity }));
}

// An overlapping interval can keep its composition accessible at the window
// edge. This is a clipped marker for the whole record, not a value at that edge.
export function recordedCutMarker(cut, start, end) {
  if (!Number.isFinite(cut.t) || cut.displayable === false) return null;
  const stop = Number.isFinite(cut.end) ? cut.end : cut.t;
  if (cut.t > end || stop < start) return null;
  return { time: Math.max(start, cut.t), clippedStart: cut.t < start };
}

function element(document, tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function recordedIntervalText(record, { formatTime = String } = {}) {
  if (!Number.isFinite(record.t)) return 'No recorded time';
  const end = Number.isFinite(record.end) && record.end !== record.t ? ` – ${formatTime(record.end)}` : '';
  return `${formatTime(record.t)}${end}`;
}

export function appendRecordedCut(container, cut, options = {}) {
  const document = container.ownerDocument;
  const line = (className, text) => container.append(element(document, 'div', className, text));
  line('k', cut.withdrawn || cut.record?.withdrawn ? 'Historical numerical reading · withdrawn' : 'Recorded numerical reading');
  if (readingNeedsReview(cut)) line('m', `Needs review: ${cut.evidence.reason}`);
  else if (cut.evidence?.status === 'untracked') line('a', 'No recorded Event-text dependency; freshness has not been checked.');
  else if (cut.evidence?.status === 'unchanged') line('a', 'The recorded Event text is unchanged. This does not verify the interpretation.');
  line('v', cut.question || cut.id);
  line('m', `Event: ${cut.eventLabel || cut.parentEventId || cut.eventId}`);
  if (cut.eventDescription && cut.eventDescription !== cut.eventLabel) line('m', cut.eventDescription);
  const name = (id) => options.referentName?.(id) ?? id;
  const participants = Object.entries(cut.participants ?? {}).map(([role, ids]) => `${role}: ${[ids].flat().map(name).join(', ')}`);
  if (participants.length) line('a', `Participants: ${participants.join(' · ')}`);
  for (const binding of cut.bindings ?? []) line('a', `${binding.role ?? binding.binding_type ?? 'Subject'}: ${name(binding.referent_id)}`);
  line('a', `Unit / local denominator: ${cut.unit ?? 'not declared'}`);
  line('a', recordedIntervalText(cut, options));
  const stack = element(document, 'div', 'split');
  const weights = element(document, 'div', 'w'); weights.style.gridTemplateColumns = 'minmax(48px, auto) 1fr';
  for (const answer of recordedCutSegments(cut)) {
    if (answer.weight > 0) { const band = element(document, 'i', ''); band.style.width = `${answer.weight * 100}%`; band.style.background = answer.color; stack.append(band); }
    const value = element(document, 'b', '', String(answer.weight)); value.style.color = answer.color;
    weights.append(value, element(document, 'i', '', answer.key));
  }
  container.append(stack, weights);
  line('a', 'Weights are shares of this Cut’s own unit. Separate readings are not a continuous curve.');
  const context = element(document, 'details', ''); context.style.marginTop = '8px';
  context.append(element(document, 'summary', '', cut.conditioning ? 'Context and conditional denominator' : 'Context'));
  appendCutContext(context, cut, name); container.append(context);
  const source = element(document, 'details', ''); source.style.marginTop = '8px';
  source.append(element(document, 'summary', '', 'Source and record'));
  source.append(element(document, 'div', 'a', `Cut: ${cut.id}`));
  if (cut.interval && Number.isFinite(cut.interval.start)) source.append(element(document, 'div', 'a', `Recorded coordinates: native start ${cut.interval.start}, end ${cut.interval.end ?? 'not declared'} ${options.timeUnit || cut.timeUnit || ''}`));
  for (const text of cut.provenance ?? []) source.append(element(document, 'div', 'a', text));
  for (const text of cut.eventProvenance ?? []) source.append(element(document, 'div', 'a', `Event source: ${text}`));
  for (const context of cut.contexts ?? []) for (const text of context.provenance ?? []) source.append(element(document, 'div', 'a', `Context source: ${text}`));
  for (const condition of cut.conditioningChain ?? []) for (const text of condition.provenance ?? []) source.append(element(document, 'div', 'a', `Condition source (${condition.cutId}): ${text}`));
  container.append(source);
  return container;
}

function appendCutContext(container, cut, name) {
  const document = container.ownerDocument;
  const line = (text) => container.append(element(document, 'div', 'a', text));
  if (!(cut.contexts ?? []).length) line('Context: no declared context root found');
  for (const context of cut.contexts ?? []) {
    line(`Context: ${context.kind ?? 'declared'} · ${context.rootId ?? context.eventId ?? context.event_id ?? context.id ?? ''}${context.label ? ` · ${context.label}` : ''}`);
    for (const [role, ids] of Object.entries(context.participants ?? {})) line(`Context ${role}: ${[ids].flat().map(name).join(', ')}`);
  }
  if (cut.contextStatus === 'ambiguous') line('More than one governing context is recorded; no single holder is assumed.');
  for (const issue of cut.contextIssues ?? []) line(`Context unresolved: ${issue}`);
  if (cut.conditioning) {
    line(`Conditional on ${cut.conditioning.cut_id ?? cut.conditioning.cutId} → ${cut.conditioning.answer_key ?? cut.conditioning.answerKey}. These weights remain local to that answer.`);
    for (const condition of cut.conditioningChain ?? []) {
      line(`Condition: ${condition.question ?? condition.cutId ?? condition.cut_id ?? condition.id} · ${condition.answerKey ?? condition.answer_key ?? ''}${condition.answer ? ` = ${condition.answer.weight}` : ''}${condition.unit ? ` · unit: ${condition.unit}` : ''} · ${condition.cutId ?? condition.cut_id ?? condition.id}`);
      if (condition.status && condition.status !== 'resolved') line(`Condition unresolved: ${condition.status}`);
      for (const context of condition.contexts ?? []) line(`Condition context: ${context.kind} · ${context.rootId}`);
    }
  }
}

function appendScalar(container, record) {
  const document = container.ownerDocument;
  container.append(element(document, 'div', 'k', 'Recorded scalar initial value'),
    element(document, 'div', 'v', record.label || record.processId || record.id),
    element(document, 'div', 'num', `${record.value} ${record.unit ?? ''}`),
    element(document, 'div', 'a', 'No recorded time · This initial value is not a time-series sample.'));
  if (record.uncertainty) {
    const uncertainty = record.uncertainty, unit = record.unit ? ` ${record.unit}` : '';
    const detail = uncertainty.kind === 'interval' ? `interval ${uncertainty.lower} – ${uncertainty.upper}${unit}`
      : uncertainty.kind === 'standard_deviation' ? `standard deviation ${uncertainty.value}${unit}`
      : ['exact', 'unknown'].includes(uncertainty.kind) ? uncertainty.kind : JSON.stringify(uncertainty);
    container.append(element(document, 'div', 'a', `Declared uncertainty: ${detail}`));
  }
  if (record.referenceFrame) container.append(element(document, 'div', 'm', `Reference frame: ${record.referenceFrame}`));
  for (const text of [...(record.support ?? []), ...(record.provenance ?? [])]) container.append(element(document, 'div', 'a', text));
}

// The panel browses the complete snapshot independently of the play cursor,
// like the manuscript reader. Details are built only when a record is opened.
export function appendRecordedNumbers(container, numerics = {}, options = {}) {
  const document = container.ownerDocument;
  container.append(element(document, 'div', 'k', 'Numbers'), element(document, 'div', 'v', 'Recorded numerical values'),
    element(document, 'div', 'a', 'The complete snapshot, independent of playback. Dated Cuts appear as separate compositions in Tree and Processes; undated records remain undated.'));
  const group = (title, records, describe, render) => {
    if (!records.length) return;
    const section = element(document, 'details', ''); section.open = title === 'Current Cuts'; section.style.marginTop = '12px';
    section.append(element(document, 'summary', '', `${title} (${records.length})`));
    for (const record of records) {
      const item = element(document, 'details', ''); item.style.margin = '8px 0';
      item.append(element(document, 'summary', '', describe(record)));
      let built = false;
      item.addEventListener('toggle', () => { if (!item.open || built) return; built = true; const body = element(document, 'div', ''); render(body, record); item.append(body); });
      section.append(item);
    }
    container.append(section);
  };
  const cutTitle = (cut) => `${cut.question || cut.id} · ${cut.eventLabel || cut.parentEventId || cut.eventId} · ${recordedIntervalText(cut, options)}`;
  group('Needs review · changed or unresolved evidence', (numerics.cuts ?? []).filter(readingNeedsReview), cutTitle, (body, cut) => appendRecordedCut(body, cut, options));
  group('Current Cuts', (numerics.cuts ?? []).filter((cut) => !readingNeedsReview(cut)), cutTitle, (body, cut) => appendRecordedCut(body, cut, options));
  group('Scalar initial values · no recorded time', numerics.scalarRecords ?? [], (record) => `${record.label || record.processId || record.id}: ${record.value} ${record.unit ?? ''}`, appendScalar);
  const historical = Array.isArray(numerics.historical) ? numerics.historical : numerics.historical?.cuts ?? [];
  group('Historical Cuts', historical, cutTitle, (body, cut) => appendRecordedCut(body, cut, options));
  if (!(numerics.cuts?.length || numerics.scalarRecords?.length || historical.length)) container.append(element(document, 'div', 'm', 'No recorded Cuts or scalar initial values in this snapshot.'));
  return container;
}
