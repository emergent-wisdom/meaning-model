// Search the snapshot: every record the views can select (the model's records and the graph's notes and passages) and
// every row the time view draws, under the names the views show, matched on all they say. A result opens where the
// reader is: a row or a note at its place in time, any other record through the shared selection.
import { buildModelGraph } from './model-graph.js';
import { cutTrajectories } from './cut-trajectories.js';
import { typedScalarTrajectories } from './scalar-trajectories.js';
import { processLabel } from './common.js';

const KINDS = Object.freeze({
  event: 'Event', process: 'Process', referent: 'Referent', normalized_cut: 'Cut', narrative: 'Note or passage',
  row: 'Answer over time', concept: 'Concept', law: 'Law', claim: 'Claim', event_relation: 'Relation', abstract_cut: 'Abstract Cut',
  abstract_relation: 'Abstract relation', realization: 'Realization', physical_cut: 'Physical Cut',
  encapsulation_cut: 'Encapsulation Cut', decomposition: 'Decomposition', dependency: 'Dependency',
});
// Records that name others without saying anything themselves are left out, and so is each answer of each Cut: its
// words are its Cut's and its row's, and as records of their own they would bury everything else.
const SKIP = new Set(['model', 'event_referent_binding', 'normalized_cut_answer']);
// The records people look for first come first among equal matches.
const PRIORITY = { event: 4, referent: 4, process: 3, row: 3, normalized_cut: 3, narrative: 2, concept: 2 };
const HASH = /^[a-f0-9]{64}$/u;

export const fold = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const kindLabel = (kind) => KINDS[kind] ?? String(kind).replace(/_/g, ' ');

// Every word a structured value holds, so a note's stored accounts, laws and readings can be found, not only its
// summary. Hashes are left out: nobody searches for them, and they would match any run of hex digits.
function wordsIn(value, out = [], depth = 0) {
  if (depth > 12 || value == null) return out;
  if (typeof value === 'string') { if (value.trim() && !HASH.test(value)) out.push(value); return out; }
  if (Array.isArray(value)) { for (const item of value) wordsIn(item, out, depth + 1); return out; }
  if (typeof value === 'object') for (const item of Object.values(value)) wordsIn(item, out, depth + 1);
  return out;
}

// What a narrative node says: an author record keeps its words in a JSON payload (its summary, then everything its data
// stores), a passage is its own text.
function narrative(record) {
  const raw = String(record?.text ?? '');
  try {
    const payload = JSON.parse(raw);
    if (payload && typeof payload === 'object') {
      const summary = [record?.title, payload.text, payload.title, payload.name, payload.data?.title].filter(Boolean).join(' · ');
      return { summary: summary || raw, text: [summary, ...wordsIn(payload.data)].filter(Boolean).join(' · ') };
    }
  } catch { /* prose, not a payload */ }
  const text = [record?.title, raw].filter(Boolean).join(' · ');
  return { summary: text, text };
}

function textOf(node) {
  const record = node.record ?? {};
  if (node.kind === 'narrative') return narrative(record).text;
  const parts = node.kind === 'event' ? [record.description]
    : node.kind === 'normalized_cut' ? [record.unit, ...(record.answers ?? []).flatMap((answer) => [answer.key, answer.meaning])]
    : node.kind === 'process' ? [record.scale?.semantic_role, record.unit, record.reference_frame]
    : node.kind === 'referent' ? [record.boundary, record.continuity_criterion]
    : node.kind === 'concept' ? [record.label, record.definition, record.differentia]
    : [record.description, record.label];
  return parts.filter((part) => typeof part === 'string' && part.trim()).join(' · ');
}

// The rows the time view draws, under the names it shows them by: each recorded Cut answer over time, each dated
// process series, and the run's own measures.
function rowsOf(data) {
  let rows = [];
  try { rows = [...(data.measures ?? []), ...cutTrajectories(data), ...typedScalarTrajectories(data)]; } catch { rows = [...(data.measures ?? [])]; }
  return rows.filter((row) => row?.id && (row.points?.length ?? 0) >= 2);
}

// A row's id is encoded JSON naming its whole series, every answer included, so it is not matched; its name and text are.
const entry = (kind, id, label, text, extra = {}) => ({ kind, id: String(id), label, text, withdrawn: false, ...extra,
  foldedLabel: fold(label), foldedId: kind === 'row' ? '' : fold(id), foldedText: fold(text) });

export function buildSearchIndex(data, graph = null) {
  const nodes = (graph ?? buildModelGraph(data?.inspection ?? {})).nodes ?? [];
  const rows = rowsOf(data ?? {});
  // A process the time view draws once is found under the name the view gives it and opens at its curve. A process
  // drawn as several series (one per holder: Alice's and Bob's readings of one temperature) keeps one result per
  // series, named by whose it is, beside the process itself.
  const rowsOfProcess = new Map();
  for (const row of rows.filter((item) => item.kind !== 'cut-answer')) {
    const key = row.processId ?? row.id;
    rowsOfProcess.set(key, [...(rowsOfProcess.get(key) ?? []), row]);
  }
  const rowOfProcess = new Map([...rowsOfProcess].filter(([, list]) => list.length === 1).map(([key, list]) => [key, list[0]]));
  const nameOf = new Map((data?.people ?? []).map((person) => [person.id, person.name]));
  const entries = nodes.filter((node) => !node.unresolved && !SKIP.has(node.kind)).map((node) => {
    if (node.kind === 'narrative') {
      const { summary, text } = narrative(node.record);
      return entry('narrative', node.nativeId, summary.slice(0, 160) || node.nativeId, text);
    }
    if (node.kind === 'process') {
      const row = rowOfProcess.get(node.nativeId);
      const shown = row?.label ?? processLabel(data ?? {}, node.nativeId);
      return entry('process', node.nativeId, shown, [node.label, textOf(node)].join(' · '), { ...(row ? { rowId: row.id } : {}) });
    }
    return entry(node.kind, node.nativeId, node.label, textOf(node), { withdrawn: Boolean(node.withdrawn) });
  });
  const processIds = new Set(nodes.filter((node) => node.kind === 'process').map((node) => node.nativeId));
  for (const row of rows) {
    if (row.kind !== 'cut-answer' && rowOfProcess.has(row.processId ?? row.id) && processIds.has(row.processId ?? row.id)) continue;
    const label = row.kind === 'cut-answer' ? row.label : row.label ?? processLabel(data ?? {}, row.id);
    const several = row.kind !== 'cut-answer' && (rowsOfProcess.get(row.processId ?? row.id)?.length ?? 0) > 1;
    const whose = several && row.holder ? `${nameOf.get(row.holder) ?? row.holder} · ` : row.group?.label ? `${row.group.label} · ` : '';
    // Outside the time view a row opens as the record it is drawn from.
    const record = row.kind === 'cut-answer' ? (row.home ? { kind: 'event', id: row.home } : null)
      : processIds.has(row.processId ?? row.id) ? { kind: 'process', id: row.processId ?? row.id } : null;
    entries.push(entry('row', row.id, `${whose}${label}`, [row.question, row.unit].filter(Boolean).join(' · '), { rowId: row.id, record, foldedName: fold(label) }));
  }
  return entries;
}

// A short piece of the text around the first match, for a result whose label does not show why it matched.
function snippet(entry, terms) {
  const at = terms.map((term) => entry.foldedText.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return null;
  const from = Math.max(0, at - 50), to = Math.min(entry.text.length, at + 90);
  return `${from ? '…' : ''}${entry.text.slice(from, to).replace(/\s+/gu, ' ').trim()}${to < entry.text.length ? '…' : ''}`;
}

// Every word of the query must appear in the record's label, id or text. A whole-label or id match ranks first, then
// a label that starts with the query, then words found in the label, then words found only in the text.
export function searchRecords(index, query, limit = 30) {
  const whole = fold(query).trim();
  const terms = whole.split(/\s+/u).filter(Boolean);
  if (!terms.length) return { total: 0, results: [] };
  const matched = [];
  for (const entry of index) {
    const haystack = `${entry.foldedLabel} ${entry.foldedId} ${entry.foldedText}`;
    if (!terms.every((term) => haystack.includes(term))) continue;
    const inLabel = terms.filter((term) => entry.foldedLabel.includes(term) || entry.foldedId.includes(term)).length;
    // A row's own name (a feeling, a process) counts as its whole label, without whose it is.
    const name = entry.foldedName ?? entry.foldedLabel;
    const score = (entry.foldedLabel === whole || name === whole || entry.foldedId === whole ? 1_000 : 0) + (entry.foldedLabel.startsWith(whole) || name.startsWith(whole) ? 200 : 0)
      + inLabel * 40 + (terms.length - inLabel) * 8 + (PRIORITY[entry.kind] ?? 1) - (entry.withdrawn ? 50 : 0);
    matched.push({ entry, score, inLabel });
  }
  matched.sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length || a.entry.label.localeCompare(b.entry.label));
  return { total: matched.length, results: matched.slice(0, limit).map(({ entry, inLabel }) => ({
    kind: entry.kind, id: entry.id, label: entry.label, kindLabel: kindLabel(entry.kind), withdrawn: entry.withdrawn,
    ...(entry.rowId ? { rowId: entry.rowId } : {}), ...(entry.record !== undefined ? { record: entry.record } : {}),
    ...(inLabel < terms.length ? { snippet: snippet(entry, terms) } : {}) })) };
}

// The field and its list. `open` receives the chosen result ({ kind, id, rowId?, record? }) and shows it.
export function mountSearch({ data, input, list, open, onOpenList = () => {} }) {
  if (!input || !list) return null;
  if (!data) { input.disabled = true; return null; }
  let index = null, results = [], active = -1;
  const ensure = () => (index ??= buildSearchIndex(data));
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const mark = (next) => {
    active = next;
    for (const [i, row] of [...list.querySelectorAll('[role="option"]')].entries()) row.setAttribute('aria-selected', String(i === active));
    const row = list.querySelector(`#search-result-${active}`);
    if (row) { input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView?.({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  };
  const choose = async (i) => {
    const result = results[i]; if (!result) return;
    close(); input.blur();
    await open(structuredClone(result));
  };
  const render = () => {
    const query = input.value;
    if (!query.trim()) { results = []; close(); return; }
    const found = searchRecords(ensure(), query);
    results = found.results;
    const head = document.createElement('div'); head.className = 'search-head';
    head.textContent = found.total ? `${found.total} match${found.total === 1 ? '' : 'es'}${found.total > results.length ? `, the first ${results.length} shown` : ''}` : 'No record matches every word.';
    const rows = results.map((result, i) => {
      const row = document.createElement('div'); row.className = 'search-row'; row.id = `search-result-${i}`; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      const kind = document.createElement('span'); kind.className = 'search-kind'; kind.textContent = result.withdrawn ? `${result.kindLabel}, withdrawn` : result.kindLabel;
      const label = document.createElement('span'); label.className = 'search-label'; label.textContent = result.label;
      row.append(kind, label);
      if (result.snippet) { const text = document.createElement('span'); text.className = 'search-snippet'; text.textContent = result.snippet; row.append(text); }
      row.addEventListener('pointerdown', (event) => event.preventDefault());
      row.addEventListener('click', () => choose(i));
      return row;
    });
    list.replaceChildren(head, ...rows);
    if (list.hidden) onOpenList();
    list.hidden = false; input.setAttribute('aria-expanded', 'true'); mark(results.length ? 0 : -1);
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); mark((active + 1) % results.length); }
    else if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); mark((active - 1 + results.length) % results.length); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(active < 0 ? 0 : active); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!list.hidden) close(); else { input.value = ''; input.blur(); } }
    // The views' own keys (walking, 0, Home) do not fire while typing.
    event.stopPropagation();
  });
  addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    event.preventDefault(); input.focus(); input.select();
  });
  return { search: (query) => searchRecords(ensure(), query), close };
}
