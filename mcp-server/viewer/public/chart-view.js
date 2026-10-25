// The Chart: the whole model on one time axis, drawn from chart-model.js. The parts of one Event, as declared, run across the top, the Events
// sit in rows under them with their causal links, and every process the model follows has a row of its own; the left
// column names each row and reads it at the moment under the pointer. A process with parts can be opened as the top of
// the rows, so only it and what it holds are drawn, with the path to it above them; a process that declares its parts add
// up to it shows them stacked beneath its curve. The panel beside it says how to read the chart and shows whatever is
// opened. Opening a record shares it with the other views through the viewer session.
import { chartModel, axisFraction, axisTicks, timeLabel, lengthLabel, readSeries, layerReading, tagCountsOf, tagWord, tagStyle, tagOf, weaker, TAGS } from './chart-model.js';
import { prepareReadings } from './interval-readings.js';
import { answerColor, ANSWER_PALETTE } from './recorded-numbers.js';
import { currentView } from './view-settings.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const FOCUS_SHARE = 0.62; // the share of the axis an opened part or dragged stretch takes
const KIND_COLOR = { causes: '#ff8a4c', enables: '#3fd3c0', prevents: '#ff4d6d', constrains: '#ff4d6d', realizes_forecast: '#b793ff' };
const KIND_WORDS = { causes: 'caused', enables: 'made possible', prevents: 'held back', constrains: 'constrained', realizes_forecast: 'fulfilled a forecast in' };
const ROLE_WORDS = { enabling: 'made it possible', enable: 'made it possible', triggering: 'set it off', trigger: 'set it off', sustaining: 'kept it going',
  sustain: 'kept it going', shaping: 'shaped how it went', shape: 'shaped how it went', directing: 'shaped how it went', preventing: 'held it back',
  prevent: 'held it back', constraining: 'held it back', hindering: 'held it back', success_condition: 'had to be in place' };
// Colours are the viewer's own: a Cut's answers take the colour every view gives that answer (moved along the palette
// only where two answers of one Cut would share one), and the parts of a process take the palette in order.
const REST = answerColor('remainder');
const OVER = '#ff6b81'; // where the parts of a declared sum exceed it
function answerInks(keys) {
  const used = new Set(), inks = new Map();
  for (const key of keys) {
    if (key === 'remainder') { inks.set(key, REST); continue; }
    let ink = answerColor(key);
    if (used.has(ink)) ink = ANSWER_PALETTE.find((colour) => !used.has(colour)) ?? ink;
    used.add(ink); inks.set(key, ink);
  }
  return inks;
}
// The parts a row stacks: those of a divided process (its own row) or of a declared sum (stacked in the process's row).
const partsOf = (row) => row.members ?? row.layers?.members ?? [];
const inksOf = (row) => (row.kind === 'cut-series' ? answerInks(row.members.map((m) => m.key))
  : new Map(partsOf(row).map((m, i) => [m.id, ANSWER_PALETTE[i % ANSWER_PALETTE.length]])));
const inkOf = (row, m) => (m.remainder ? REST : inksOf(row).get(row.kind === 'cut-series' ? m.key : m.id));
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [children].flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
};
const svg = (tag, attrs = {}, children = []) => {
  const node = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) node.setAttribute(key, value);
  for (const child of [children].flat()) if (child) node.append(child);
  return node;
};
const f1 = (n) => (Math.round(n * 10) / 10).toString();
// An Event's title without the date clause that ends it ("The Black Death, 1346 to 1353." -> "The Black Death").
const shortTitle = (title) => String(title ?? '').replace(/\.$/u, '').split(/,\s(?=(?:about|from|c\.|\d|[A-Z][a-z]+ \d|to |the \d))/u)[0];
const words = (key) => String(key ?? '').replace(/_/g, ' ');
const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
// A name to letter on the chart: the title without its date clause or a leading article.
const bare = (title) => capital(shortTitle(title).replace(/^The /u, ''));

// A number with sensible precision: three significant figures, grouped, no trailing zeros; a percent unit keeps its sign.
function num(v) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) return Math.round(v).toLocaleString('en-US');
  if (abs >= 100) return String(Math.round(v));
  if (abs === 0) return '0';
  return Number(v.toPrecision(abs >= 1 ? 3 : 2)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
const isPercent = (unit) => /^%|^percent\b|\bas % of\b/u.test(String(unit ?? ''));
const figure = (v, unit) => (isPercent(unit) ? `${num(v)}%` : num(v)).replace(/^-/u, '−');
const lower = (text) => (/^[A-Z][a-z]/u.test(text ?? '') ? text.charAt(0).toLowerCase() + text.slice(1) : text);
const share = (w) => (w <= 0 ? '0%' : w < 0.005 ? 'under 1%' : `${Math.round(w * 100)}%`);

// How a row is scaled: a log scale when its values span more than two orders of magnitude and are not a percentage;
// otherwise a straight scale from zero when its values sit near zero, or around its values when they do not.
function scaleFor(values, unit) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { kind: 'linear', lo: 0, hi: 1 };
  const hi = Math.max(...finite), lo = Math.min(...finite);
  if (lo > 0 && !isPercent(unit) && hi / lo > 200) return { kind: 'log', lo: 10 ** Math.floor(Math.log10(lo)), hi: 10 ** Math.ceil(Math.log10(hi)) };
  if (lo >= 0 && lo <= hi * 0.35) return { kind: 'linear', lo: 0, hi: hi * 1.06 || 1 };
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  return { kind: 'linear', lo: lo - pad, hi: hi + pad };
}

// noteAddress is the viewer's check of each address it writes against the model's chosen view (chosen-view.js).
export function showChart(data, { host: surface, tools, onSelect = () => {}, noteAddress = () => {} }) {
  const C = chartModel(data);
  surface.replaceChildren();
  if (!C.available) { surface.append(el('p', { class: 'cv-empty', text: C.reason })); return { activate() {}, deactivate() {}, getState: () => ({}), destroy() { surface.replaceChildren(); } }; }
  const mm = data.inspection?.model?.meaning_model ?? {};
  const modelEvent = new Map((mm.events ?? []).map((e) => [e.id, e]));
  const fullTitle = (id) => modelEvent.get(id)?.boundary ?? C.byId.get(id)?.label ?? id;
  const at = (t, span) => timeLabel(t, { unit: C.unit, present: C.present, span });
  const spanText = (a, b) => (Math.abs(b - a) < 1e-9 ? at(a, 1) : `${at(a, b - a)} to ${at(b, b - a)}`);

  // ---- state ---------------------------------------------------------------------------------------------------------------------
  let scaleId = C.defaultScale;
  // The whole whose parts run across the top: the view's focus setting (the reader's, or the model's recorded view).
  const focusSetting = new URLSearchParams(globalThis.location?.search ?? '').get('focus');
  let whole = C.wholes.some((w) => w.id === focusSetting) ? focusSetting : null;
  let openPart = null;     // the part of the whole whose own parts are laid out under it
  let bandParts = [];      // what the head lays out: [{ ...part, level, lane }]
  let rowsOfEvents = [];
  function layoutParts() {
    const top = whole ? C.partsOf(whole).map((p) => ({ ...p, level: 0 })) : [];
    if (!top.some((p) => p.id === openPart)) openPart = null;
    bandParts = [...top, ...(openPart ? C.partsOf(openPart).map((p) => ({ ...p, level: 1 })) : [])];
    rowsOfEvents = C.eventRows(scaleId, new Set([...(whole ? [whole] : []), ...bandParts.map((p) => p.id)]));
  }
  layoutParts();
  // The process opened as the top of the rows: the view's `within` setting. Only it and the parts it holds are drawn; without
  // one the rows are the whole tree.
  const withinSetting = new URLSearchParams(globalThis.location?.search ?? '').get('within');
  let within = C.tree.from(withinSetting) ? withinSetting : null;
  let shown = within ? C.tree.from(within) : null; // what the opened top draws: { rows, path, has }
  let treeRows = shown ? shown.rows : C.rows;
  let focus = null;        // an opened stretch of time: it takes most of the axis
  let opened = null;       // what the panel shows: { kind, id }
  let pinT = null, hoverT = null;
  // The shared time as the Chart last received it, and whether the reader has since pinned a moment here: only then
  // does the Chart's moment become the shared time (time.now, in the time views' units).
  let sharedTime = null, pinnedHere = false;
  let showAllLinks = false;
  let showTop = false;     // the parts and Events above the time axis, off at first so the rows have the whole height
  let pinTop = false;      // on, they stay fixed above the rows; off, they scroll away and only the time axis stays
  const collapsed = new Set(C.rows.length > 60 ? C.rows.filter((r) => r.kind === 'group').map((r) => r.id) : []);
  let L = null;
  let active = false;

  // ---- the time axis, with an opened part or stretch widened -------------------------------------------------------------------------------
  const base = axisFraction(C.axis);
  function makeScale(stretch) {
    if (!stretch) return base;
    const a = base(stretch.start), b = base(stretch.end);
    const rest = a + (1 - b), left = rest > 0 ? (1 - FOCUS_SHARE) * (a / rest) : 0, share = rest > 0 ? FOCUS_SHARE : 1;
    return (t) => {
      if (t <= stretch.start) return a > 0 ? (base(t) / a) * left : 0;
      if (t >= stretch.end) return 1 - b > 0 ? left + share + ((base(t) - b) / (1 - b)) * (1 - left - share) : 1;
      return left + share * ((t - stretch.start) / (stretch.end - stretch.start));
    };
  }
  let scaleFrom = base, scaleTo = base, mix = 1, animation = 0;
  const unitAt = (t) => (mix >= 1 ? scaleTo(t) : scaleFrom(t) * (1 - mix) + scaleTo(t) * mix);
  const timeAt = (u) => { let lo = C.axis.start, hi = C.axis.end; for (let i = 0; i < 52; i += 1) { const mid = (lo + hi) / 2; if (unitAt(mid) < u) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const along = (t) => L.padL + unitAt(Math.max(C.axis.start, Math.min(C.axis.end, t))) * (L.plotW - L.padL - L.padR);
  const alongTo = (t) => L.padL + scaleTo(Math.max(C.axis.start, Math.min(C.axis.end, t))) * (L.plotW - L.padL - L.padR);

  // ---- DOM --------------------------------------------------------------------------------------------------------------------------
  const root = el('div', { class: 'cv' });
  root.style.setProperty('--cv-over', OVER); root.style.setProperty('--cv-rest', REST);
  const chart = el('section', { class: 'cv-chart', 'aria-label': 'The model on one time axis' });
  const scroller = el('div', { class: 'cv-scroll' });
  const head = el('div', { class: 'cv-head' });
  const headStub = el('div', { class: 'cv-stub cv-head-stub' });
  const headPlot = el('div', { class: 'cv-plot cv-head-plot' });
  const headArt = svg('svg', { class: 'cv-art', 'aria-hidden': 'true', focusable: 'false' });
  const bandLayer = el('div', { class: 'cv-ctl', role: 'group', 'aria-label': 'Periods' });
  const eventLayer = el('div', { class: 'cv-ctl', role: 'group', 'aria-label': 'Events in time order. Use the arrow keys to move between them.' });
  const headSel = el('div', { class: 'cv-selcol', hidden: true }), headCursor = el('div', { class: 'cv-cursor', hidden: true }), flag = el('div', { class: 'cv-flag', 'aria-hidden': 'true' });
  headPlot.append(headSel, headArt, bandLayer, eventLayer, headCursor, flag);
  head.append(headStub, headPlot);
  const body = el('div', { class: 'cv-body' });
  const rowList = el('div', { class: 'cv-rows', role: 'list', 'aria-label': 'The processes the model follows, as its tree' });
  const bodySel = el('div', { class: 'cv-selcol', hidden: true }), bodyCursor = el('div', { class: 'cv-cursor', hidden: true });
  body.append(rowList, el('div', { class: 'cv-overlay', 'aria-hidden': 'true' }, [bodySel, bodyCursor]));
  scroller.append(head, body);
  const foot = el('div', { class: 'cv-foot' });
  const crumbs = el('nav', { class: 'cv-crumbs', 'aria-label': 'Where in the tree of processes the rows are opened', hidden: true });
  chart.append(crumbs, scroller, foot);
  // The reading card: the viewer's details card, in the right column; it closes, and Reading in the controls brings it back.
  const panel = el('aside', { class: 'cv-panel', 'aria-label': 'Reading' });
  const panelNav = el('nav', { class: 'cv-panel-nav', 'aria-label': 'Reading' });
  const panelBody = el('article', { class: 'cv-panel-body', tabindex: '-1' });
  const closePanel = el('button', { type: 'button', class: 'cv-close', 'aria-label': 'Close the reading card', title: 'Close', text: '✕', onclick: () => showPanel(false) });
  panel.append(el('div', { class: 'cv-panel-bar' }, [panelNav, closePanel]), panelBody);
  root.append(chart, panel);
  root.classList.add('has-panel');
  surface.append(root);

  // Controls in the viewer's row: which importance scale sorts the Event rows, and every causal link at once.
  const controls = [];
  if (C.scaleChoices.length > 1) {
    const select = el('select', { 'aria-label': 'Which importance scale sorts the Event rows' }, C.scaleChoices.map((s) => el('option', { value: s.id, text: `${capital(s.audience ?? words(s.id))} (${s.count})` })));
    select.value = scaleId;
    select.addEventListener('change', () => { scaleId = select.value; layoutParts(); relayout(true); showOpened(); });
    controls.push(el('label', { class: 'tool picker cv-scale', title: 'Rows of Events by the levels of one importance scale' }, [el('i', { text: 'Ranked for' }), select]));
  }
  // Which whole's parts run across the top; the choice is the view's focus setting, kept in the address, where a change
  // to the model's chosen view marks it adjusted so reopening the address keeps the reader's choice.
  if (C.wholes.length) {
    const byDepth = [...C.wholes].sort((a, b) => a.depth - b.depth || a.start - b.start);
    const select = el('select', { 'aria-label': 'Whose parts run across the top' }, [el('option', { value: '', text: 'Nothing' }),
      ...byDepth.map((w) => el('option', { value: w.id, text: `${' '.repeat(Math.min(6, w.depth))}${shortTitle(w.label)} (${w.parts})` }))]);
    select.value = whole ?? '';
    select.addEventListener('change', () => {
      whole = select.value || null; openPart = null;
      if (whole && !showTop) applyTop(true);
      try { const url = new URL(location.href); if (whole) url.searchParams.set('focus', whole); else url.searchParams.delete('focus'); history.replaceState(history.state, '', url); noteAddress(); } catch { /* the address is a convenience */ }
      setFocus(null); layoutParts(); buildBands(); relayout(true); showOpened();
    });
    controls.push(el('label', { class: 'tool picker cv-parts', title: 'The parts of one Event, as the model contains them, run across the top' }, [el('i', { text: 'Parts of' }), select]));
  }
  const linksButton = el('button', { type: 'button', class: 'tool switch', 'aria-pressed': 'false', title: 'Draw every causal link between the Events, faintly', text: `All links (${C.links.length})`,
    onclick: () => { showAllLinks = !showAllLinks; linksButton.setAttribute('aria-pressed', String(showAllLinks)); drawHead(); } });
  if (C.links.length) controls.push(linksButton);
  // Events: the parts and Events above the time axis, off at first. On, they sit above the axis and scroll away with
  // the rows, so the rows can always be seen; Pin keeps them fixed above the rows, for a tall screen. Off, only the axis
  // stays at the top; the reading at the pointer and an opened Event's time are still shown on the rows.
  const eventsButton = el('button', { type: 'button', class: 'tool switch', 'aria-pressed': 'false', text: 'Events',
    title: 'Show or hide the parts and Events above the time axis', onclick: () => { applyTop(!showTop); relayout(true); if (!opened) showOpened(); } });
  controls.push(eventsButton);
  const pinButton = el('button', { type: 'button', class: 'tool switch', 'aria-pressed': 'false', text: 'Pin',
    title: 'Keep the parts and Events fixed above the rows while they scroll, for a tall screen', onclick: () => { pinTop = !pinTop; pinButton.setAttribute('aria-pressed', String(pinTop)); relayout(true); } });
  controls.push(pinButton);
  function applyTop(on) {
    showTop = on; eventsButton.setAttribute('aria-pressed', String(on));
    bandLayer.hidden = !on; eventLayer.hidden = !on; linksButton.disabled = !on; pinButton.hidden = !on || !active;
  }
  applyTop(showTop);
  const readingButton = el('button', { type: 'button', class: 'tool switch', 'aria-pressed': 'true', title: 'Show or hide the reading card', text: 'Reading',
    onclick: () => showPanel(panel.hidden) });
  controls.push(readingButton);
  function showPanel(on) { panel.hidden = !on; root.classList.toggle('has-panel', on); readingButton.setAttribute('aria-pressed', String(on)); }
  // Back to the whole span after a part was opened or a stretch dragged across.
  const zoomOut = el('button', { type: 'button', class: 'tool', hidden: true, text: 'Whole span', title: 'Show the whole span again (Esc)', onclick: () => setFocus(null) });
  controls.push(zoomOut);
  tools?.append(...controls);

  // ---- rows: one per row of the model's tree, the whole of it or what one opened process holds -------------------------------------------
  // Whose a row's values are and, where one holder has several series, what tells this one apart.
  const heldBy = (row) => [row.holder ? `held by ${row.holder}` : 'no holder named', row.apart].filter(Boolean).join(' · ');
  const rowName = (row) => (row.holders > 1 ? `${row.label} (${heldBy(row)})` : row.label);
  // A row that stacks the parts its process declares add up to it.
  const stacksParts = (row) => Boolean(row.layers?.members.length);
  let rowById = new Map(), rowOfProcess = new Map(), rowScale = new Map(), rowViews = [], viewById = new Map();
  let hatches = 0;
  // One line of a row's list of parts: a chip, a name and the value read at the moment.
  const shareLine = (row, m, chip = null, title = null) => {
    const val = el('span', { class: 'cv-share-val' });
    return { val, li: el('li', { title }, [el('span', { class: `cv-chip${chip ? ` ${chip}` : ''}`, style: chip === 'is-over' ? null : `--chip:${m.remainder ? REST : inkOf(row, m)}`, 'aria-hidden': 'true' }),
      el('span', { class: 'cv-share-name', text: m.label }), val]) };
  };
  function mountRows() {
    rowById = new Map(treeRows.map((r) => [r.id, r]));
    // A process's own row (its first); a process with several series has a row for each.
    rowOfProcess = new Map();
    for (const r of treeRows) if (r.kind === 'measure' && !rowOfProcess.has(r.process)) rowOfProcess.set(r.process, r);
    rowScale = new Map();
    for (const row of treeRows) {
      if (row.kind === 'measure' && row.series) {
        const points = row.series.points;
        const values = points.flatMap((p) => [p.v, p.uncertainty?.lower, p.uncertainty?.upper]);
        // Layers stand on zero and add up in the row's own unit, so a stacked row reads on a straight scale from zero.
        rowScale.set(row.id, row.series.states ? { kind: 'states', lo: -0.5, hi: row.series.states.length - 0.5 }
          : stacksParts(row) ? { kind: 'linear', lo: 0, hi: Math.max(row.layers.top, ...values.filter(Number.isFinite)) * 1.06 || 1 } : scaleFor(values, row.unit));
      } else if (row.kind === 'stack') {
        const times = [...new Set(row.members.flatMap((m) => m.series.points.map((p) => p.t)))];
        const sums = times.map((t) => row.members.reduce((sum, m) => sum + Math.max(0, readSeries(m.series, t)?.v ?? 0), 0));
        rowScale.set(row.id, { kind: 'stack', lo: 0, hi: Math.max(isPercent(row.unit) ? 100 : 0, ...sums) || 1 });
      }
    }
    rowList.replaceChildren();
    rowViews = treeRows.map((row) => {
      const hasKids = row.children.length > 0;
      const scale = rowScale.get(row.id);
      const layers = stacksParts(row) ? row.layers : null;
      const stub = el('div', { class: 'cv-stub cv-row-stub', style: `--depth:${row.depth}` });
      const toggle = hasKids ? el('button', { type: 'button', class: 'cv-disclose', 'aria-expanded': 'true', 'aria-label': `Hide what ${row.label} holds`, onclick: (event) => { event.stopPropagation(); toggleRow(row.id); } })
        : el('span', { class: 'cv-disclose-space', 'aria-hidden': 'true' });
      const name = el('button', { type: 'button', class: 'cv-row-name', title: `${row.label}${row.unit ? `, ${row.unit}` : ''}`, onclick: () => open(row.kind === 'group' && row.event ? { kind: 'event', id: row.event } : { kind: 'row', id: row.id }) },
        el('span', { class: 'cv-row-label', text: row.kind === 'group' ? shortTitle(row.label) : row.label }));
      // A process that holds parts can be opened as the top of the rows: only it and what it holds are drawn.
      const openTop = row.kind === 'measure' && hasKids && row.process !== within
        ? el('button', { type: 'button', class: 'cv-open', text: 'Open', title: `Open ${row.label} as the top: draw only it and its parts`, 'aria-label': `Open ${row.label} as the top of the rows`,
          onclick: (event) => { event.stopPropagation(); setTop(row.process, { focus: true }); } }) : null;
      const unitText = row.kind === 'group' ? (Number.isFinite(row.start) ? spanText(row.start, row.end) : '') : row.kind === 'cut-series' ? `${row.unit}${row.owner ? ` · ${row.owner}` : ''}`
        : `${row.holders > 1 ? `${heldBy(row)} · ` : ''}${row.unit ?? ''}${scale?.kind === 'log' ? ' · log scale' : ''}`;
      const unitLine = el('span', { class: 'cv-row-unit', text: unitText, title: unitText || null });
      const val = el('span', { class: 'cv-row-val' }), tag = el('span', { class: 'cv-row-tag' });
      // The parts a row lists: a divided process's own row, or the parts a declared sum stacks in its process's row, with
      // the remainder and the excess where its values have them, and the parts it lists without stacking.
      let values = null, stackVals = null;
      if (row.members) values = el('ul', { class: 'cv-row-shares' }, row.members.map((m) => shareLine(row, m).li));
      else if (layers || row.layers?.listed.length) {
        const own = (layers?.members ?? []).map((m) => shareLine(row, m));
        const rest = layers?.gap ? shareLine(row, { label: 'Remainder', remainder: true }, null, 'What the whole holds beyond its parts') : null;
        const over = layers?.over ? shareLine(row, { label: 'Parts exceed it' }, 'is-over', 'Where its parts add up to more than the whole') : null;
        const listed = row.layers.listed.length ? el('li', { class: 'cv-share-listed', text: `Not stacked: ${row.layers.listed.map((x) => x.label).join(', ')}`,
          title: row.layers.listed.map((x) => `${x.label}: ${x.why}`).join('\n') }) : null;
        values = el('ul', { class: 'cv-row-shares' }, [...own.map((x) => x.li), rest?.li, over?.li, listed]);
        stackVals = { parts: own.map((x) => x.val), rest: rest?.val ?? null, over: over?.val ?? null };
      }
      stub.append(...[el('div', { class: 'cv-row-line' }, [toggle, name, openTop]), unitText ? el('div', { class: 'cv-row-line cv-row-line-2' }, unitLine) : null,
        row.kind === 'measure' ? el('div', { class: 'cv-row-line cv-row-line-3' }, [val, tag]) : null, values].filter(Boolean));
      const plot = el('div', { class: 'cv-plot cv-row-plot' });
      const art = svg('svg', { class: 'cv-art', 'aria-hidden': 'true', focusable: 'false' });
      plot.append(art);
      const node = el('div', { class: `cv-row cv-row-${row.kind}`, role: 'listitem', 'data-id': row.id }, [stub, plot]);
      rowList.append(node);
      return { row, node, toggle, name, val, tag, values, stackVals, unitLine, art, plot, hatch: `cv-hatch-${++hatches}`, dirty: true, visible: true };
    });
    viewById = new Map(rowViews.map((v) => [v.row.id, v]));
    io.disconnect();
    for (const view of rowViews) io.observe(view.node);
    applyCollapsed();
  }
  const descendants = (id) => { const out = []; const walk = (r) => { for (const c of r?.children ?? []) { out.push(c); walk(rowById.get(c)); } }; walk(rowById.get(id)); return out; };
  function applyCollapsed() {
    const hidden = new Set([...collapsed].flatMap((c) => descendants(c)));
    for (const view of rowViews) {
      view.node.hidden = hidden.has(view.row.id);
      if (view.toggle.tagName !== 'BUTTON') continue;
      const isOpen = !collapsed.has(view.row.id);
      view.toggle.setAttribute('aria-expanded', String(isOpen));
      view.toggle.setAttribute('aria-label', `${isOpen ? 'Hide' : 'Show'} what ${view.row.label} holds${isOpen ? '' : ` (${descendants(view.row.id).length} rows)`}`);
      view.node.classList.toggle('is-collapsed', !isOpen);
    }
  }
  function toggleRow(id) { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); applyCollapsed(); drawRows(true); }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) { const view = viewById.get(entry.target.dataset.id); if (!view) continue; view.visible = entry.isIntersecting; if (view.visible && view.dirty) drawRow(view); }
  }, { root: scroller, rootMargin: '300px 0px' });
  mountRows();

  // ---- the path to the opened top, and opening and closing it --------------------------------------------------------------------
  // All processes returns to the whole tree; each step of the path opens that level. The path is the chain above the top in
  // the whole tree, so it reads the same however the top was reached.
  function renderCrumbs() {
    crumbs.hidden = !within;
    if (!within) { crumbs.replaceChildren(); return; }
    const path = shown.path;
    crumbs.replaceChildren(el('button', { type: 'button', class: 'cv-crumb cv-crumb-all', text: 'All processes', title: 'Draw the whole tree of processes again', onclick: () => setTop(null, { focus: true }) }),
      ...path.flatMap((step, i) => [el('span', { class: 'cv-crumb-sep', 'aria-hidden': 'true', text: '›' }),
        i === path.length - 1 ? el('span', { class: 'cv-crumb is-here', 'aria-current': 'location', text: step.label, title: step.label })
          : el('button', { type: 'button', class: 'cv-crumb', text: step.label, title: `Open ${step.label} as the top`, onclick: () => setTop(step.id, { focus: true }) })]));
  }
  // The top is the view's `within` setting, kept in the address as the focus is: a change to the model's chosen view marks
  // it adjusted, so reopening or sharing the address keeps the reader's choice.
  function setTop(id, { write = true, focus: keep = false } = {}) {
    const next = id && C.tree.from(id) ? id : null;
    if (next === within) return;
    const before = within;
    within = next; shown = within ? C.tree.from(within) : null; treeRows = shown ? shown.rows : C.rows;
    if (within) collapsed.delete(within);
    if (write) { try { const url = new URL(location.href); if (within) url.searchParams.set('within', within); else url.searchParams.delete('within'); history.replaceState(history.state, '', url); noteAddress(); } catch { /* the address is a convenience */ } }
    // What was open stays open where it is still drawn; a row the new top leaves out closes.
    mountRows(); renderCrumbs(); buildKey();
    if (opened?.kind === 'row' && !rowById.has(opened.id)) { opened = null; onSelect(null); }
    for (const v of rowViews) v.node.classList.toggle('is-selected', opened?.kind === 'row' && v.row.id === opened.id);
    scroller.scrollTo({ top: 0 });
    relayout(true); showOpened();
    if (keep) viewById.get(within ?? before)?.name.focus?.();
  }
  // A process the rows do not draw, asked for from elsewhere (a search result, a link from an Event): the nearest level
  // above the top that does draw it opens, up to the whole tree.
  function widenFor(process) {
    if (!within || rowOfProcess.has(process) || !C.tree.rowOf(process)) return;
    const above = shown.path.map((step) => step.id).reverse().slice(1);
    setTop(above.find((id) => C.tree.from(id)?.has.has(process)) ?? null);
  }

  // ---- layout ---------------------------------------------------------------------------------------------------------------------------
  const headLabels = new Map();
  function measure() {
    const width = scroller.clientWidth || chart.clientWidth || 800;
    const narrow = width < 640;
    const stubW = narrow ? 0 : Math.round(Math.min(280, Math.max(200, width * 0.24)));
    const padL = 10, padR = narrow ? 10 : 48;
    const lanes = [];
    // Each level of parts takes as many lanes as its overlapping parts need.
    const laneCount = (level) => bandParts.filter((p) => p.level === level).reduce((n, p) => Math.max(n, p.lane + 1), 0);
    const n0 = showTop ? laneCount(0) : 0, n1 = showTop ? laneCount(1) : 0, shownRows = showTop ? rowsOfEvents : [];
    if (n0) lanes.push(['band0', n0 * (narrow ? 24 : 26)]);
    if (n1) lanes.push(['band1', n1 * 22]);
    const strip = shownRows.length > 1 && shownRows[0].key.startsWith('level:');
    if (strip) lanes.push(['strip', narrow ? 30 : 44]);
    shownRows.forEach((row, i) => lanes.push([`events:${row.key}`, (i === 0 && strip ? 30 : 24) * lanesOf(row)]));
    // The time axis last, right above the rows: unpinned, everything above it scrolls away and the axis stays.
    lanes.push(['ticks', 24]);
    const y = {}; let acc = 0;
    for (const [key, h] of lanes) { y[key] = [acc, acc + h]; acc += h + (key === 'band1' || (key === 'band0' && !n1) ? 2 : 0); }
    const headH = acc + 6;
    const eventsTop = y.strip?.[0] ?? y[shownRows.length ? `events:${shownRows[0].key}` : 'ticks'][0];
    root.style.setProperty('--cv-stub', `${stubW}px`); root.style.setProperty('--cv-head-h', `${headH}px`);
    root.style.setProperty('--cv-head-top', `${pinTop ? 0 : -(headH - (y.ticks[1] - y.ticks[0]) - 6)}px`);
    root.classList.toggle('is-narrow', narrow);
    // The column heads: what each lane of the head is.
    const wanted = [['band0', n0 ? `Parts of ${bare(labelOf(whole))}` : null],
      ['band1', n1 ? `Parts of ${bare(labelOf(openPart))}` : null], ['ticks', null], ...(strip ? [['strip', null]] : []),
      ...shownRows.map((row) => [`events:${row.key}`, row.label])];
    headStub.replaceChildren();
    for (const [key, text] of wanted) {
      if (!y[key]) continue;
      const node = key === 'ticks' ? el('div', { class: 'cv-hs cv-hs-year' }, [el('span', { class: 'cv-hs-year-label', text: 'Rows read at' }), el('strong', { class: 'cv-hs-year-value' })])
        : el('div', { class: `cv-hs${key.startsWith('events:') ? ' cv-hs-events' : ''}`, text: text ?? '',
          title: key === 'band0' ? `The parts of ${labelOf(whole)}, as the model contains them` : key === 'band1' ? `The parts of ${labelOf(openPart)}, as the model contains them`
            : rowsOfEvents.find((r) => `events:${r.key}` === key)?.title ?? null });
      node.style.top = `${y[key][0]}px`; node.style.height = `${y[key][1] - y[key][0]}px`;
      headStub.append(node); headLabels.set(key, node);
    }
    const plotW = Math.max(160, width - stubW);
    return { width, narrow, stubW, plotW, padL, padR, y, headH, eventsTop, strip, minGap: narrow ? 24 : 22, laneH: { 0: narrow ? 24 : 26, 1: 22 } };
  }
  // A row no importance scale sorts is laid out in up to three lanes, so fewer Events have to be counted together.
  const lanesOf = (row) => (row.key.startsWith('level:') ? 1 : row.events.length >= 12 ? 3 : row.events.length >= 6 ? 2 : 1);
  const labelOf = (id) => shortTitle(C.byId.get(id)?.label ?? data.events?.find((e) => e.id === id)?.label ?? id);
  // A row that stacks parts is as tall as the list of them beside it needs.
  const listedLines = (row) => row.layers.members.length + (row.layers.gap ? 1 : 0) + (row.layers.over ? 1 : 0) + (row.layers.listed.length ? 1 : 0);
  function rowHeight(row) {
    if (row.kind === 'group') return L.narrow ? 26 : 30;
    if (row.kind === 'stack' || row.kind === 'cut-series') return L.narrow ? 70 : 96;
    if (stacksParts(row)) return L.narrow ? 70 : Math.max(96, 60 + 15 * listedLines(row));
    const plain = row.depth === 0 ? (L.narrow ? 42 : 54) : (L.narrow ? 36 : 46);
    return row.layers?.listed.length && !L.narrow ? Math.max(plain, 76) : plain;
  }

  // ---- Events: single marks, or counted groups where marks would overlap ------------------------------------------------------------
  let units = [], tickXs = [], tickNodes = [];
  const unitNodes = new Map();
  let rovingKey = null;
  const eventById = new Map(C.events.map((e) => [e.id, e]));
  const eventRow = new Map(); for (const row of rowsOfEvents) for (const id of row.events) eventRow.set(id, row.key);
  function computeUnits() {
    eventRow.clear(); for (const row of rowsOfEvents) for (const id of row.events) eventRow.set(id, row.key);
    if (!showTop) { for (const node of unitNodes.values()) node.remove(); unitNodes.clear(); units = []; rovingKey = null; return; }
    const out = [];
    rowsOfEvents.forEach((row, index) => {
      const list = row.events.map((id) => eventById.get(id)).filter(Boolean).map((e) => ({ e, x: alongTo(e.start) })).sort((a, b) => a.x - b.x || a.e.start - b.e.start);
      if (index === 0 && L.strip && list.length <= 24) {
        // The highest-ranked Events are never grouped: marks too close together move apart, each keeping a line to its date.
        const xs = list.map((item) => item.x);
        for (let i = 1; i < xs.length; i += 1) xs[i] = Math.max(xs[i], xs[i - 1] + L.minGap);
        const right = L.plotW - L.padR + 6;
        if (xs.length && xs.at(-1) > right) { xs[xs.length - 1] = right; for (let i = xs.length - 2; i >= 0; i -= 1) xs[i] = Math.min(xs[i], xs[i + 1] - L.minGap); }
        list.forEach((item, i) => out.push({ key: `e:${item.e.id}`, row: row.key, kind: 'mark', members: [item.e], e: item.e, offset: xs[i] - item.x, top: true }));
        return;
      }
      // Each Event goes to the first lane where it clears the last mark; where none is clear, to the lane that ends earliest.
      const laneCount = lanesOf(row), last = Array(laneCount).fill(-Infinity);
      for (const item of list) {
        let lane = last.findIndex((x) => item.x - x >= L.minGap);
        if (lane < 0) lane = last.indexOf(Math.min(...last));
        item.lane = lane; last[lane] = Math.max(last[lane], item.x);
      }
      const chains = [];
      for (let lane = 0; lane < laneCount; lane += 1) {
        let current = null;
        for (const item of list.filter((x) => x.lane === lane)) { if (current && item.x - current.at(-1).x < L.minGap) current.push(item); else { current = [item]; chains.push(current); } }
      }
      const maxSpan = L.minGap * 3;
      const split = (chain) => {
        if (chain.length < 2 || chain.at(-1).x - chain[0].x <= maxSpan) return [chain];
        let best = 1, gap = -1; for (let i = 1; i < chain.length; i += 1) { const g = chain[i].x - chain[i - 1].x; if (g > gap) { gap = g; best = i; } }
        return [...split(chain.slice(0, best)), ...split(chain.slice(best))];
      };
      for (const chain of chains.flatMap(split)) {
        const members = chain.map((c) => c.e);
        out.push(members.length === 1 ? { key: `e:${members[0].id}`, row: row.key, lane: chain[0].lane ?? 0, kind: 'mark', members, e: members[0] }
          : { key: `c:${members.map((m) => m.id).join('|')}`, row: row.key, lane: chain[0].lane ?? 0, kind: 'group', members });
      }
    });
    out.sort((a, b) => a.members[0].start - b.members[0].start);
    units = out;
    const keep = new Set(units.map((u) => u.key));
    for (const [key, node] of unitNodes) if (!keep.has(key)) { node.remove(); unitNodes.delete(key); }
    for (const u of units) {
      let node = unitNodes.get(u.key);
      if (!node) {
        if (u.kind === 'mark') {
          const e = u.e;
          node = el('button', { type: 'button', class: `cv-mark${u.top ? ' is-top' : ''}${e.weighed ? ' is-weighed' : ''}`, 'data-key': u.key,
            'aria-label': `${shortTitle(e.label)}, ${at(e.start, e.end - e.start)}${e.weighed ? '. Its causes are weighed' : ''}.`, title: `${e.label}${e.weighed ? ' · its causes are weighed' : ''}`,
            onclick: () => open({ kind: 'event', id: e.id }) }, el('span', { class: 'cv-shape', 'aria-hidden': 'true' }));
        } else {
          const a = u.members[0].start, b = u.members.at(-1).start;
          const text = `${u.members.length} Events too close together to draw apart here, ${at(a, b - a)} to ${at(b, b - a)}`;
          node = el('button', { type: 'button', class: 'cv-cluster', 'data-key': u.key, 'aria-label': `${text}. Open the list.`, title: `${text}: open the list`,
            onclick: () => open({ kind: 'group', ids: u.members.map((m) => m.id), id: u.key }) }, el('span', { class: 'cv-count', text: String(u.members.length) }));
          if (u.members.some((m) => m.weighed)) node.classList.add('has-weighed');
        }
        node.addEventListener('focus', () => { rovingKey = u.key; setRoving(); pinHover(u.members[0].start); });
        node.addEventListener('blur', () => pinHover(null));
      }
      eventLayer.append(node);
      unitNodes.set(u.key, node);
    }
    if (!rovingKey || !unitNodes.has(rovingKey)) rovingKey = units[0]?.key ?? null;
    setRoving();
  }
  function setRoving() { for (const [key, node] of unitNodes) node.tabIndex = key === rovingKey ? 0 : -1; }
  const unitOf = (eventId) => units.find((u) => u.members.some((m) => m.id === eventId));
  roving(eventLayer, () => units.map((u) => unitNodes.get(u.key)), (node) => { rovingKey = node.dataset.key; setRoving(); });

  // Parts across the top: buttons, rebuilt when the whole or the opened part changes.
  const bandNodes = new Map();
  function buildBands() {
    bandLayer.replaceChildren(); bandNodes.clear();
    for (const item of bandParts) {
      const node = el('button', { type: 'button', class: `cv-band cv-band-${item.level}`, 'aria-label': `${shortTitle(item.label)}, ${spanText(item.start, item.end)}. Open it.`,
        title: `${shortTitle(item.label)}: ${spanText(item.start, item.end)}${lengthLabel(item.start, item.end, C.unit) ? `, ${lengthLabel(item.start, item.end, C.unit)}` : ''}`,
        onclick: () => open({ kind: 'event', id: item.id }) }, [el('span', { class: 'cv-band-name', text: bare(item.label) })]);
      node.addEventListener('focus', () => pinHover(item.start)); node.addEventListener('blur', () => pinHover(null));
      bandLayer.append(node); bandNodes.set(`${item.level}:${item.id}`, node);
    }
    [...bandNodes.values()].forEach((node, i) => { node.tabIndex = i === 0 ? 0 : -1; });
  }
  buildBands();
  roving(bandLayer, () => [...bandNodes.values()]);
  function roving(container, nodes, onMove) {
    container.addEventListener('keydown', (event) => {
      const list = nodes().filter(Boolean); const i = list.indexOf(document.activeElement); if (i < 0) return;
      const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation();
      const target = list[Math.max(0, Math.min(list.length - 1, next))];
      for (const node of list) node.tabIndex = node === target ? 0 : -1;
      target.focus(); onMove?.(target);
    });
  }

  // ---- drawing the head: the axis, the parts, the Events and their links ---------------------------------------------------------
  const textWidth = (() => { const cache = new Map(); return (size) => { if (cache.has(size)) return cache.get(size); const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) { const fn = (t) => String(t).length * size * 0.55; cache.set(size, fn); return fn; }
    ctx.font = `500 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; const fn = (t) => ctx.measureText(String(t)).width; cache.set(size, fn); return fn; }; })();
  const fit = (text, max, measureText) => { if (measureText(text) <= max) return text; let lo = 0, hi = text.length; while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (measureText(`${text.slice(0, mid)}…`) <= max) lo = mid; else hi = mid - 1; } return lo >= 5 ? `${text.slice(0, lo).trimEnd()}…` : ''; };
  function drawHead() {
    const { y, plotW } = L;
    headPlot.style.height = `${L.headH}px`;
    headArt.setAttribute('viewBox', `0 0 ${plotW} ${L.headH}`); headArt.setAttribute('width', plotW); headArt.setAttribute('height', L.headH);
    const layer = [], labels = [];
    // Parts, each in its lane. A name that does not fit its band is not cut: it shows when there is room, else on hover.
    for (const item of bandParts) {
      const node = bandNodes.get(`${item.level}:${item.id}`); if (!node || !y[`band${item.level}`]) continue;
      const x0 = along(item.start), x1 = along(item.end), laneH = L.laneH[item.level];
      const r0 = y[`band${item.level}`][0] + item.lane * laneH;
      node.style.transform = `translate(${f1(x0)}px, ${r0}px)`; node.style.width = `${f1(Math.max(2, x1 - x0 + 1))}px`; node.style.height = `${laneH - 2}px`;
      const name = bare(item.label);
      node.classList.toggle('is-unnamed', x1 - x0 < textWidth(item.level ? 11.5 : 12.5)(name) + 14);
      node.classList.toggle('is-open', focus?.id === item.id || opened?.id === item.id);
    }
    // Ticks.
    const ticks = axisTicks({ ...C.axis }, C.unit, C.present, L.plotW - L.padL - L.padR, textWidth(11));
    tickXs = []; tickNodes = [];
    let right = -Infinity;
    for (const tick of focus ? focusTicks() : ticks) {
      const x = along(tick.t), w = textWidth(11)(tick.text);
      const left = Math.max(2, Math.min(plotW - w - 2, x - w / 2));
      if (left < right + 12) continue;
      right = left + w; tickXs.push(x);
      if (L.eventsTop < y.ticks[0]) layer.push(svg('line', { x1: f1(x), x2: f1(x), y1: L.eventsTop, y2: y.ticks[0] + 4, class: 'cv-tick-line' }));
      layer.push(svg('line', { x1: f1(x), x2: f1(x), y1: y.ticks[1] - 5, y2: L.headH, class: 'cv-tick-line' }));
      const node = svg('text', { x: f1(left + w / 2), y: y.ticks[1] - 8, class: 'cv-tick-label', 'text-anchor': 'middle' }, tick.text);
      tickNodes.push({ node, left, right: left + w }); layer.push(node);
    }
    for (const row of rowsOfEvents) if (y[`events:${row.key}`]) layer.push(svg('line', { x1: 0, x2: plotW, y1: y[`events:${row.key}`][1] - 0.5, y2: y[`events:${row.key}`][1] - 0.5, class: 'cv-row-rule' }));
    // Marks at the Events' starts; an opened Event's whole time is shaded across the chart.
    const centre = (key, lane = 0) => { const [a, b] = y[`events:${key}`]; const n = lanesOf(rowsOfEvents.find((r) => r.key === key)); return a + ((b - a) / n) * (lane + 0.5); };
    const placed = new Map();
    for (const u of units) {
      const node = unitNodes.get(u.key), cy = centre(u.row, u.lane);
      if (u.kind === 'mark') {
        const x = along(u.e.start) + (u.offset ?? 0);
        placed.set(u.key, { x, y: cy, x0: x, x1: x });
        if (Math.abs(u.offset ?? 0) > 1) layer.push(svg('line', { x1: f1(x), y1: f1(cy + 7), x2: f1(along(u.e.start)), y2: f1(y[`events:${u.row}`][1] - 1), class: 'cv-leader' }));
        node.style.transform = `translate(${f1(x - 11)}px, ${f1(cy - 11)}px)`;
      } else {
        const xs = u.members.map((m) => along(m.start));
        placed.set(u.key, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: cy, x0: Math.min(...xs), x1: Math.max(...xs) });
      }
    }
    for (const row of rowsOfEvents) {
      const list = units.filter((u) => u.row === row.key).sort((a, b) => a.lane - b.lane || placed.get(a.key).x0 - placed.get(b.key).x0);
      list.forEach((u, i) => {
        if (u.kind !== 'group') return;
        const sameLane = (other) => other && other.lane === u.lane;
        const p = placed.get(u.key);
        let left = p.x0 - 10, rightEdge = p.x1 + 10;
        if (rightEdge - left < 26) { const mid = (left + rightEdge) / 2; left = mid - 13; rightEdge = mid + 13; }
        const prev = sameLane(list[i - 1]) && placed.get(list[i - 1].key), next = sameLane(list[i + 1]) && placed.get(list[i + 1].key);
        if (prev) left = Math.max(left, (list[i - 1].kind === 'mark' ? prev.x1 + 11 : prev.right ?? prev.x1 + 10) + 1);
        if (next) rightEdge = Math.min(rightEdge, (list[i + 1].kind === 'mark' ? next.x0 - 11 : next.x0 - 10) - 1);
        if (rightEdge - left < 22) { const mid = (left + rightEdge) / 2; left = mid - 11; rightEdge = mid + 11; }
        p.left = left; p.right = rightEdge;
        const node = unitNodes.get(u.key);
        node.style.transform = `translate(${f1(left)}px, ${f1(p.y - 10)}px)`; node.style.width = `${f1(rightEdge - left)}px`;
      });
    }
    const lit = new Set(opened?.kind === 'group' ? opened.ids : opened?.lit ?? []);
    for (const u of units) {
      const node = unitNodes.get(u.key);
      node.classList.toggle('is-selected', u.members.some((m) => m.id === opened?.id));
      node.classList.toggle('is-lit', u.members.some((m) => lit.has(m.id)));
    }
    // Names: the top row's in a strip above it; every other mark beside itself where it fits.
    if (L.strip) {
      const lines = L.narrow ? 2 : 3; const occupied = Array.from({ length: lines }, () => []);
      const lineY = (i) => y.strip[0] + 11 + i * ((y.strip[1] - y.strip[0] - 6) / lines);
      const measureText = textWidth(L.narrow ? 10.5 : 11.5);
      for (const u of units.filter((x) => x.top)) {
        const p = placed.get(u.key);
        const text = fit(bare(u.e.label), Math.min(L.narrow ? 120 : 220, plotW * 0.4), measureText);
        if (!text) continue;
        const w = measureText(text), x0 = p.x > plotW * 0.6 ? p.x + 6 - w : p.x - 6;
        const lx0 = Math.max(2, Math.min(plotW - w - 2, x0));
        const line = occupied.findIndex((list) => !list.some(([a, b]) => lx0 < b + 10 && lx0 + w > a - 10));
        if (line < 0) continue;
        occupied[line].push([lx0, lx0 + w]);
        layer.push(svg('line', { x1: f1(p.x), x2: f1(p.x), y1: lineY(line) + 3, y2: p.y - 8, class: 'cv-leader' }));
        labels.push(svg('text', { x: f1(lx0), y: lineY(line), class: `cv-strip-label${u.e.weighed ? ' is-weighed' : ''}` }, text));
      }
    }
    if (!L.narrow) {
      for (const row of rowsOfEvents) {
        const list = units.filter((u) => u.row === row.key && !u.top).sort((a, b) => a.lane - b.lane || placed.get(a.key).x0 - placed.get(b.key).x0);
        list.forEach((u, i) => {
          if (u.kind !== 'mark') return;
          const p = placed.get(u.key); const next = list[i + 1]?.lane === u.lane ? placed.get(list[i + 1].key) : null;
          const room = (next ? (next.left ?? next.x0 - 11) : plotW - L.padR) - (p.x + 13) - 8;
          if (room < 44) return;
          const text = fit(bare(u.e.label), room, textWidth(10.5));
          if (text) labels.push(svg('text', { x: f1(p.x + 13), y: p.y + 3.5, class: 'cv-inline-label' }, text));
        });
      }
    }
    // Causal links: every one faintly when asked for; an opened Event's in full, thicker for causes that made more difference.
    const arcs = [];
    const posOf = (id) => { const u = unitOf(id); if (u) return placed.get(u.key); const p = [...bandParts].reverse().find((x) => x.id === id); if (p && y[`band${p.level}`]) { const r0 = y[`band${p.level}`][0] + p.lane * L.laneH[p.level]; return { x: (along(p.start) + along(p.end)) / 2, y: r0 + L.laneH[p.level] - 2 }; } return null; };
    const arc = (from, to, kind, cls, width) => {
      const a = posOf(from), b = posOf(to); if (!a || !b || a === b) return;
      const x1 = a.x, y1 = a.y - 6, x2 = b.x, y2 = b.y - 6;
      const lift = Math.min(78, Math.max(18, Math.abs(x2 - x1) * 0.32));
      const topY = Math.max(L.eventsTop + 4, Math.min(y1, y2) - lift);
      arcs.push(svg('path', { d: `M${f1(x1)},${f1(y1)} C${f1(x1)},${f1(topY)} ${f1(x2)},${f1(topY)} ${f1(x2)},${f1(y2)}`, class: `cv-arc ${cls}`, stroke: KIND_COLOR[kind] ?? '#c3c2b7',
        'stroke-width': width ?? null, 'marker-end': cls === 'is-all' ? null : 'url(#cv-arrow)' }));
    };
    if (showAllLinks) for (const link of C.links) arc(link.from, link.to, link.kind, 'is-all');
    const ends = new Set();
    if (opened?.kind === 'event') {
      const weight = new Map();
      for (const q of C.why.get(opened.id) ?? []) { const max = Math.max(...q.ranked.map((c) => Math.abs(c.difference ?? 0)), 1e-9); for (const c of q.ranked) weight.set(c.cause, Math.max(weight.get(c.cause) ?? 0, Math.abs(c.difference ?? 0) / max)); }
      for (const link of C.links) {
        if (link.to === opened.id) { arc(link.from, link.to, link.kind, 'is-in', f1(1.3 + 3.2 * (weight.get(link.from) ?? 0.25))); ends.add(link.from); }
        if (link.from === opened.id) { arc(link.from, link.to, link.kind, 'is-out', 1.3); ends.add(link.to); }
      }
    }
    for (const u of units) unitNodes.get(u.key).classList.toggle('is-linked', u.members.some((m) => ends.has(m.id)));
    headArt.replaceChildren(svg('defs', {}, svg('marker', { id: 'cv-arrow', viewBox: '0 0 8 8', refX: 6.5, refY: 4, markerWidth: 8, markerHeight: 8, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
      svg('path', { d: 'M0,0.8 L7,4 L0,7.2 Z', class: 'cv-arrow-head' }))), ...layer, ...arcs, ...labels);
    headArt.classList.toggle('has-arcs', arcs.length > 0 && opened?.kind === 'event');
    placeOverlays();
  }
  // Inside an opened part or stretch the axis is even: ticks at round steps across it, and the coarse ones outside.
  function focusTicks() {
    const inside = axisTicks({ kind: 'linear', start: focus.start, end: focus.end }, C.unit, C.present, (L.plotW - L.padL - L.padR) * FOCUS_SHARE, textWidth(11));
    const outside = axisTicks({ ...C.axis }, C.unit, C.present, (L.plotW - L.padL - L.padR) * (1 - FOCUS_SHARE), textWidth(11)).filter((t) => t.t < focus.start || t.t > focus.end);
    return [...outside, ...inside].sort((a, b) => a.t - b.t);
  }

  // ---- drawing the rows -----------------------------------------------------------------------------------------------------------------
  const stepsBetween = (times) => { const out = []; for (let i = 0; i < times.length; i += 1) { if (i > 0) { const n = Math.max(1, Math.ceil(Math.abs(along(times[i]) - along(times[i - 1])) / 5)); for (let k = 1; k < n; k += 1) out.push(times[i - 1] + ((times[i] - times[i - 1]) * k) / n); } out.push(times[i]); } return out; };
  function yScale(scale, h) {
    const top = 6, bottom = h - 5;
    if (scale.kind === 'log') { const a = Math.log10(scale.lo), b = Math.log10(scale.hi); return (v) => bottom - ((Math.log10(Math.max(v, scale.lo)) - a) / (b - a)) * (bottom - top); }
    return (v) => bottom - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * (bottom - top);
  }
  function axisText(v, row) { const s = Math.abs(v) >= 10000 ? `${num(v / 1000)}k` : num(v); return isPercent(row.unit) ? `${s}%` : s; }
  function drawRow(view) {
    const { row, art } = view;
    if (view.node.hidden) return;
    const h = rowHeight(row), W = L.plotW;
    view.plot.style.height = `${h}px`; view.node.style.setProperty('--cv-row-h', `${h}px`);
    art.setAttribute('viewBox', `0 0 ${W} ${h}`); art.setAttribute('width', W); art.setAttribute('height', h);
    const parts = [];
    for (const x of tickXs) parts.push(svg('line', { x1: f1(x), x2: f1(x), y1: 0, y2: h, class: 'cv-tick-line' }));
    if (row.kind === 'group') {
      if (Number.isFinite(row.start)) { const x0 = along(row.start), x1 = along(row.end); parts.push(svg('rect', { x: f1(x0), y: f1(h / 2 - 3), width: f1(Math.max(2, x1 - x0)), height: 6, rx: 3, class: 'cv-life' })); }
    } else if (row.kind === 'measure' && row.series) drawLine(parts, row, h, W, view);
    else if (row.kind === 'stack') drawStack(parts, row, h, W);
    else if (row.kind === 'cut-series') drawCutSeries(parts, row, h);
    art.replaceChildren(...parts);
    view.dirty = false;
  }
  function drawLine(parts, row, h, W, view) {
    const scale = rowScale.get(row.id), ys = yScale(scale, h);
    const points = row.series.points;
    if (scale.kind === 'log') {
      let lastY = Infinity;
      for (let p = Math.floor(Math.log10(scale.hi)); p >= Math.ceil(Math.log10(scale.lo)); p -= 1) {
        const yy = ys(10 ** p); parts.push(svg('line', { x1: 0, x2: W - L.padR + 4, y1: f1(yy), y2: f1(yy), class: 'cv-grid-line' }));
        const ty = Math.max(9, Math.min(h - 2, yy + 3.5));
        if (!L.narrow && Math.abs(ty - lastY) >= 11) { parts.push(svg('text', { x: W - L.padR + 8, y: f1(ty), class: 'cv-axis-label' }, axisText(10 ** p, row))); lastY = ty; }
      }
    } else if (scale.kind === 'states') {
      row.series.states.forEach((state, i) => { const yy = ys(i); parts.push(svg('line', { x1: 0, x2: W - L.padR + 4, y1: f1(yy), y2: f1(yy), class: 'cv-grid-line' })); if (!L.narrow && row.series.states.length <= 4) parts.push(svg('text', { x: W - L.padR + 8, y: f1(yy + 3.5), class: 'cv-axis-label' }, fit(words(state.key), L.padR - 10, textWidth(10)))); });
    } else {
      if (scale.lo < 0 && scale.hi > 0) parts.push(svg('line', { x1: 0, x2: W - L.padR + 4, y1: f1(ys(0)), y2: f1(ys(0)), class: 'cv-grid-line is-zero' }));
      parts.push(svg('line', { x1: 0, x2: W - L.padR + 4, y1: f1(ys(scale.lo)), y2: f1(ys(scale.lo)), class: 'cv-base-line' }));
      if (!L.narrow) { parts.push(svg('text', { x: W - L.padR + 8, y: f1(ys(scale.hi) + 7), class: 'cv-axis-label' }, axisText(scale.hi, row))); parts.push(svg('text', { x: W - L.padR + 8, y: f1(ys(scale.lo) - 1), class: 'cv-axis-label' }, axisText(scale.lo, row))); }
    }
    if (stacksParts(row)) drawLayers(parts, row, h, view);
    // Only between the first and last recorded values: unrecorded time stays empty.
    const times = stepsBetween(points.map((p) => p.t).filter((t) => t >= C.axis.start && t <= C.axis.end));
    const readings = times.map((t) => readSeries(row.series, t));
    const ranges = []; let run = [];
    readings.forEach((r, i) => { if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi)) run.push([times[i], r]); else if (run.length) { ranges.push(run); run = []; } });
    if (run.length) ranges.push(run);
    for (const r of ranges) if (r.length > 1) parts.push(svg('path', { d: `M${[...r.map(([t, v]) => `${f1(along(t))},${f1(ys(v.hi))}`), ...r.map(([t, v]) => `${f1(along(t))},${f1(ys(v.lo))}`).reverse()].join('L')}Z`, class: 'cv-range' }));
    let seg = null; const lines = [];
    for (let i = 0; i < times.length; i += 1) {
      const r = readings[i]; if (!r) continue;
      const next = readings[i + 1];
      const style = next ? tagStyle(weaker(r.tag, next.tag)) : seg?.style ?? tagStyle(r.tag);
      const point = `${f1(along(times[i]))},${f1(ys(r.v))}`;
      if (!seg || seg.style !== style) { if (seg) { seg.pts.push(point); lines.push(seg); } seg = { style, pts: [point] }; } else seg.pts.push(point);
    }
    if (seg) lines.push(seg);
    for (const line of lines) {
      if (line.pts.length < 2) continue;
      const d = `M${line.pts.join(row.series.interpolation?.kind === 'step-hold' ? 'L' : 'L')}`;
      if (stacksParts(row)) parts.push(svg('path', { d, class: 'cv-line-halo' }));
      parts.push(svg('path', { d, class: `cv-line is-${line.style}` }));
    }
    if (points.length === 1 || lines.every((line) => line.pts.length < 2)) for (const p of points) parts.push(svg('circle', { cx: f1(along(p.t)), cy: f1(ys(p.v)), r: 2.4, class: 'cv-dot' }));
  }
  function drawStack(parts, row, h) {
    const scale = rowScale.get(row.id); const top = 4, bottom = h - 4;
    const across = (v) => bottom - (v / scale.hi) * (bottom - top);
    const times = stepsBetween([...new Set(row.members.flatMap((m) => m.series.points.map((p) => p.t)))].filter((t) => t >= C.axis.start && t <= C.axis.end).sort((a, b) => a - b));
    // Where every part has a value the parts are stacked as recorded, never rescaled to fill the whole.
    const stacks = times.map((t) => { const read = row.members.map((m) => readSeries(m.series, t)); if (read.some((r) => !r)) return null; let acc = 0; return read.map((r) => { const a = acc; acc += Math.max(0, r.v); return [a, acc, r.tag]; }); });
    row.members.forEach((m, k) => {
      let run = [];
      const flush = () => { if (run.length > 1) parts.push(svg('path', { d: `M${[...run.map(([t, s]) => `${f1(along(t))},${f1(across(s[1]))}`), ...run.map(([t, s]) => `${f1(along(t))},${f1(across(s[0]))}`).reverse()].join('L')}Z`, fill: inkOf(row, m), class: 'cv-band-path' })); run = []; };
      times.forEach((t, i) => { if (stacks[i]) run.push([t, stacks[i][k]]); else flush(); });
      flush();
    });
    if (isPercent(row.unit)) parts.push(svg('line', { x1: 0, x2: L.plotW - L.padR + 4, y1: f1(across(100)), y2: f1(across(100)), class: 'cv-grid-line' }));
    if (!L.narrow) parts.push(svg('text', { x: L.plotW - L.padR + 8, y: f1(across(scale.hi) + 7), class: 'cv-axis-label' }, axisText(scale.hi, row)));
  }
  // The parts a declared sum stacks, in the process's own row and beneath its curve: each between the running total before
  // it and after it, over the time where the whole and every part are recorded (as a divided process is stacked, never
  // rescaled to fill the whole). What the whole holds beyond them is the remainder, plain. Where they add up to more than
  // the whole the excess is hatched and outlined, so it is marked, not hidden.
  function drawLayers(parts, row, h, view) {
    const layers = row.layers, ys = yScale(rowScale.get(row.id), h);
    const times = stepsBetween(layers.times.filter((t) => t >= C.axis.start && t <= C.axis.end));
    const reads = times.map((t) => layerReading(row, t));
    const runs = []; let run = [];
    reads.forEach((r, i) => { if (r) run.push([times[i], r]); else if (run.length) { runs.push(run); run = []; } });
    if (run.length) runs.push(run);
    const band = (points, upper, lower) => `M${[...points.map(([t, r]) => `${f1(along(t))},${f1(ys(upper(r)))}`), ...points.map(([t, r]) => `${f1(along(t))},${f1(ys(lower(r)))}`).reverse()].join('L')}Z`;
    if (layers.over) parts.push(svg('defs', {}, svg('pattern', { id: view.hatch, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: OVER, 'stroke-width': 1.7 }))));
    for (const points of runs.filter((r) => r.length > 1)) {
      layers.members.forEach((m, k) => parts.push(svg('path', { d: band(points, (r) => r.tops[k], (r) => (k ? r.tops[k - 1] : 0)), fill: inkOf(row, m), class: 'cv-band-path is-layer' })));
      if (layers.gap) parts.push(svg('path', { d: band(points, (r) => r.sum + r.gap, (r) => r.sum), fill: REST, class: 'cv-band-path is-layer is-rest' }));
      if (!layers.over) continue;
      // The excess, stretch by stretch, so only where it is gets an outline; each stretch tapers to nothing at its ends.
      for (let i = 0; i < points.length; i += 1) {
        if (!(points[i][1].over > 0)) continue;
        let j = i; while (j + 1 < points.length && points[j + 1][1].over > 0) j += 1;
        const stretch = points.slice(Math.max(0, i - 1), Math.min(points.length, j + 2));
        parts.push(svg('path', { d: band(stretch, (r) => r.sum, (r) => r.sum - r.over), fill: `url(#${view.hatch})`, stroke: OVER, class: 'cv-over' }));
        i = j;
      }
    }
    // A small flag above the stack at each date where the parts add up to more than the whole, however thin the excess.
    for (const x of layers.exceeds.filter((x) => x.t >= C.axis.start && x.t <= C.axis.end)) {
      const cx = along(x.t), top = ys(x.sum);
      parts.push(svg('path', { d: `M${f1(cx - 3.6)},${f1(top - 10)}L${f1(cx + 3.6)},${f1(top - 10)}L${f1(cx)},${f1(top - 3)}Z`, fill: OVER, class: 'cv-over-flag' },
        svg('title', {}, `${at(x.t, 1)}: its parts add up to ${figure(x.sum, row.unit)}, more than the whole by ${figure(x.by, row.unit)}${x.inRange ? ', within the range it states' : ''}`)));
    }
  }
  // A Cut series is drawn as the reading column reads it (readingAt, at the current zoom), its answers stacked: between
  // each pair of neighbouring reading boundaries, each answer's level at the middle of that stretch. Inside a longer
  // reading that has finer ones open, the time they leave uncovered shows the derived level it must average (dimmer),
  // and nothing where no level can hold. A moment's reading is a narrow bar.
  function drawCutSeries(parts, row, h) {
    const top = 4, bottom = h - 4, readers = cutReaders(row);
    const stackAt = (x0, x1, levels) => {
      let acc = 0;
      row.members.forEach((m, k) => {
        const level = levels[k], v = level?.value; if (!(v > 0)) return;
        const y1 = bottom - acc * (bottom - top), y0 = bottom - (acc + v) * (bottom - top); acc += v;
        parts.push(svg('rect', { x: f1(x0), y: f1(y0), width: f1(Math.max(1.5, x1 - x0)), height: f1(Math.max(0.5, y1 - y0)), fill: inkOf(row, m), class: `cv-cut-part${level.derived ? ' is-derived' : ''}` }));
      });
    };
    const points = row.members.flatMap((m) => m.points);
    const bounds = [...new Set(points.flatMap((p) => [p.t, p.end]).filter(Number.isFinite))].sort((a, b) => a - b);
    // Neighbouring stretches that read alike are drawn as one.
    let run = null;
    const flush = () => { if (run) stackAt(along(run.from), along(run.to), run.levels); run = null; };
    for (let i = 1; i < bounds.length; i += 1) {
      const from = bounds[i - 1], to = bounds[i];
      const levels = readers.map((read) => read((from + to) / 2));
      const key = JSON.stringify(levels.map((level) => [level?.value ?? null, Boolean(level?.derived)]));
      if (run && run.key === key) { run.to = to; continue; }
      flush(); run = { from, to, levels, key };
    }
    flush();
    const moments = new Map();
    row.members.forEach((m, k) => { for (const p of m.points) if (!(p.end > p.t)) { if (!moments.has(p.cutId)) moments.set(p.cutId, { t: p.t, levels: [] }); moments.get(p.cutId).levels[k] = { value: p.v }; } });
    for (const moment of moments.values()) stackAt(along(moment.t), along(moment.t) + 3, moment.levels);
  }
  function drawRows(all = false) { for (const view of rowViews) { view.dirty = true; if (all || view.visible) drawRow(view); } placeOverlays(); }

  // ---- the reading column: every row read at one moment ------------------------------------------------------------------------------
  const visibleSpan = () => (focus ? focus.end - focus.start : C.axis.end - C.axis.start);
  // A Cut reading wide enough to see at the current zoom, as the time views judge it: the drawing and the reading column
  // read Cut series at this one resolution, so they agree.
  const cutResolution = () => ({ minSpan: visibleSpan() * 0.015 });
  // Each Cut series' answers prepared for reading at that resolution, kept until the zoom changes: the nesting of its
  // readings is worked out once, shared by its answers (they read the same intervals), and used by every stretch drawn
  // and by the reading column.
  const preparedCuts = new Map();
  function cutReaders(row) {
    const resolution = cutResolution();
    let kept = preparedCuts.get(row);
    if (kept?.minSpan !== resolution.minSpan) {
      const readers = [];
      for (const m of row.members) readers.push(prepareReadings(m.points, resolution, readers[0]));
      kept = { minSpan: resolution.minSpan, readers }; preparedCuts.set(row, kept);
    }
    return kept.readers;
  }
  function readAt(t) {
    const when = t ?? C.readAt;
    const yearNode = headLabels.get('ticks')?.querySelector('.cv-hs-year-value'); if (yearNode) yearNode.textContent = at(when, visibleSpan());
    for (const view of rowViews) {
      const { row } = view;
      if (row.kind === 'measure') {
        const r = row.series ? readSeries(row.series, when) : null;
        view.val.textContent = !r ? (row.series ? 'no value then' : '') : r.state ? words(r.state) : `${r.between ? '~\u2009' : ''}${figure(r.v, row.unit)}`;
        view.val.title = r?.between ? 'Between two recorded values: read along the line joining them' : '';
        view.tag.textContent = r ? tagWord(r.tag) : ''; view.tag.className = `cv-row-tag is-${r ? tagStyle(r.tag) : 'none'}`;
        if (view.stackVals) {
          // Each part is read as any value is; the remainder and the excess only where the whole and every part have a value.
          const read = layerReading(row, when), mark = read?.between ? '~\u2009' : '';
          row.layers.members.forEach((m, i) => { const x = readSeries(m.series, when); view.stackVals.parts[i].textContent = x ? `${x.between ? '~\u2009' : ''}${figure(x.v, row.unit)}` : '—'; });
          if (view.stackVals.rest) view.stackVals.rest.textContent = read ? `${mark}${read.gap > 0 ? figure(read.gap, row.unit) : '0'}` : '—';
          if (view.stackVals.over) view.stackVals.over.textContent = read ? (read.over > 0 ? `${mark}by ${figure(read.over, row.unit)}` : 'none') : '—';
        }
      } else if (row.kind === 'stack') {
        view.values.querySelectorAll('.cv-share-val').forEach((node, i) => { const r = readSeries(row.members[i].series, when); node.textContent = r ? `${r.between ? '~\u2009' : ''}${figure(r.v, row.unit)}` : '—'; });
      } else if (row.kind === 'cut-series') {
        const readers = cutReaders(row);
        view.values.querySelectorAll('.cv-share-val').forEach((node, i) => { const r = readers[i](when); node.textContent = r && Number.isFinite(r.value) ? share(r.value) : '—'; });
      }
    }
  }
  function placeOverlays() {
    if (!L) return;
    const t = hoverT ?? pinT;
    for (const cursor of [headCursor, bodyCursor]) { cursor.hidden = t === null; if (t !== null) { cursor.style.transform = `translateX(${f1(along(t))}px)`; cursor.classList.toggle('is-pin', hoverT === null); } }
    const shown = t ?? (L.narrow ? C.readAt : null);
    flag.hidden = shown === null;
    if (shown !== null) {
      flag.textContent = t === null ? `Rows read at ${at(shown, visibleSpan())}` : at(shown, visibleSpan());
      const x = along(shown), fx = Math.max(0, Math.min(L.plotW - flag.offsetWidth, x - flag.offsetWidth / 2));
      flag.style.transform = `translate(${f1(fx)}px, ${L.y.ticks[0] + 2}px)`;
      for (const tick of tickNodes) tick.node.classList.toggle('is-covered', tick.right > fx - 6 && tick.left < fx + flag.offsetWidth + 6);
    } else for (const tick of tickNodes) tick.node.classList.remove('is-covered');
    const sel = opened?.kind === 'event' ? eventById.get(opened.id) ?? C.byId.get(opened.id) : null;
    for (const node of [headSel, bodySel]) { node.hidden = !sel; if (sel) { const x0 = along(sel.start), x1 = along(sel.end); node.style.transform = `translateX(${f1(x0)}px)`; node.style.width = `${f1(Math.max(2, x1 - x0))}px`; } }
    readAt(t);
  }
  function pinHover(t) { hoverT = t; placeOverlays(); }
  let frame = 0;
  function pointerTime(event) {
    const rect = headPlot.getBoundingClientRect(); const x = event.clientX - rect.left;
    if (x < L.padL - 2 || x > L.plotW - L.padR + 2) return null;
    return timeAt((x - L.padL) / (L.plotW - L.padL - L.padR));
  }
  scroller.addEventListener('pointermove', (event) => { if (event.pointerType !== 'mouse' && !event.buttons) return; const t = pointerTime(event); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { hoverT = t; placeOverlays(); }); });
  scroller.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') { hoverT = null; placeOverlays(); } });
  scroller.addEventListener('pointerdown', (event) => { if (event.pointerType === 'mouse' || event.target.closest('button')) return; const t = pointerTime(event); if (t !== null) { hoverT = t; placeOverlays(); } });
  // A drag across the chart widens the stretch dragged over, as opening a part does; a click pins the reading there.
  const brush = el('div', { class: 'cv-brush', hidden: true }); headPlot.append(brush);
  let dragFrom = null, dragged = false;
  scroller.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return; dragFrom = { x: event.clientX, t: pointerTime(event) }; dragged = false; });
  const onDragMove = (event) => {
    if (!dragFrom || dragFrom.t === null) return;
    if (Math.abs(event.clientX - dragFrom.x) > 6) dragged = true;
    if (!dragged) return;
    const rect = headPlot.getBoundingClientRect(), a = dragFrom.x - rect.left, b = Math.max(L.padL, Math.min(L.plotW - L.padR, event.clientX - rect.left));
    brush.hidden = false; brush.style.transform = `translateX(${f1(Math.min(a, b))}px)`; brush.style.width = `${f1(Math.abs(b - a))}px`;
  };
  const onDragEnd = (event) => {
    if (!dragFrom) return;
    const from = dragFrom; dragFrom = null; brush.hidden = true;
    if (!dragged || from.t === null) return;
    const rect = headPlot.getBoundingClientRect(), x = Math.max(L.padL, Math.min(L.plotW - L.padR, event.clientX - rect.left));
    const to = timeAt((x - L.padL) / (L.plotW - L.padL - L.padR));
    const start = Math.min(from.t, to), end = Math.max(from.t, to);
    if (end - start > (C.axis.end - C.axis.start) * 1e-4) setFocus({ id: null, start, end });
  };
  addEventListener('pointermove', onDragMove); addEventListener('pointerup', onDragEnd);
  scroller.addEventListener('click', (event) => {
    if (dragged) { dragged = false; return; }
    if (event.target.closest('button')) return; const t = pointerTime(event); if (t !== null) { pinT = t; pinnedHere = true; placeOverlays(); }
  });

  // ---- the key -----------------------------------------------------------------------------------------------------------------------
  // Only what the rows drawn carry: the tags of their values, a range, stacked parts, a remainder and an excess where they have them.
  function buildKey() {
    const tagCounts = tagCountsOf(treeRows);
    const items = [];
    if (C.events.some((e) => e.weighed)) items.push(el('li', {}, [el('span', { class: 'cv-key-mark is-weighed', 'aria-hidden': 'true' }), 'Filled: its causes are weighed']), el('li', {}, [el('span', { class: 'cv-key-mark', 'aria-hidden': 'true' }), 'Open: not weighed']));
    items.push(el('li', {}, [el('span', { class: 'cv-key-count', 'aria-hidden': 'true', text: '3' }), 'Events too close to draw apart: open the list']));
    for (const [tag, info] of Object.entries(TAGS)) if (tagCounts[tag]) items.push(el('li', { title: info.long }, [el('span', { class: `cv-key-line is-${info.style}`, 'aria-hidden': 'true' }), capital(info.word)]));
    for (const tag of Object.keys(tagCounts).filter((tag) => !TAGS[tag])) items.push(el('li', {}, [el('span', { class: 'cv-key-line is-rough', 'aria-hidden': 'true' }), capital(tag)]));
    if (treeRows.some((r) => r.series?.points?.some((p) => p.uncertainty?.kind === 'interval'))) items.push(el('li', {}, [el('span', { class: 'cv-key-range', 'aria-hidden': 'true' }), 'Range']));
    if (treeRows.some(stacksParts)) items.push(el('li', { title: 'A process the model declares as the sum of its parts shows them stacked in its own unit, adding up to it' }, [el('span', { class: 'cv-key-layers', 'aria-hidden': 'true', style: `--a:${ANSWER_PALETTE[0]};--b:${ANSWER_PALETTE[1]};--c:${ANSWER_PALETTE[2]}` }), 'Stacked parts that add up to it']));
    if (treeRows.some((r) => r.layers?.gap)) items.push(el('li', {}, [el('span', { class: 'cv-key-rest', 'aria-hidden': 'true' }), 'Remainder: what the whole holds beyond its parts']));
    if (treeRows.some((r) => r.layers?.over)) items.push(el('li', {}, [el('span', { class: 'cv-key-over', 'aria-hidden': 'true' }), 'Hatched: its parts add up to more than the whole']));
    items.push(el('li', {}, [el('b', { text: '~' }), 'between two recorded values']));
    foot.replaceChildren(el('ul', { class: 'cv-key', 'aria-label': 'How to read the marks and lines' }, items),
      el('p', { class: 'cv-axis-note', text: C.axis.kind === 'log' ? `Time is squeezed toward the past: each step to the left covers more time (a log scale of time before ${at(C.latest, Infinity)}). An opened part, or a stretch dragged across, is drawn evenly.` : 'Time runs evenly from left to right.' }));
  }
  buildKey();
  renderCrumbs();

  // ---- the panel --------------------------------------------------------------------------------------------------------------------
  const link = (target, text, cls = 'cv-link') => el('button', { type: 'button', class: cls, text, onclick: () => open(target) });
  // A short heading is a label, as in the viewer's menus; a question is read as a sentence.
  const sec = (title, ...content) => el('section', { class: 'cv-sec' }, [el('h3', { class: String(title).length > 32 ? 'is-long' : null, text: title }), ...content.flat().filter(Boolean)]);
  const para = (text, cls = 'cv-prose') => (text ? el('p', { class: cls, text }) : null);
  const meta = (...bits) => el('p', { class: 'cv-meta', text: bits.filter(Boolean).join(' · ') });
  const tagLine = (provenance) => { const tag = tagOf(provenance?.[0]); return tag ? el('span', { class: `cv-tag is-${tagStyle(tag)}`, title: TAGS[tag]?.long ?? tag, text: tagWord(tag) }) : null; };
  const levelOf = (id) => { const row = rowsOfEvents.find((r) => r.events.includes(id)); return row?.key.startsWith('level:') ? row.label : null; };
  const scale = () => C.scaleChoices.find((s) => s.id === scaleId) ?? null;
  // The tour is the model's own: the highlights of the view it recorded (life_model_viewer_view), in its order and with
  // its reason for each. Without a recorded view there is no tour.
  const chosen = currentView(data.views ?? []);
  const stops = (chosen ? [...(chosen.highlights ?? []), ...(chosen.levels ?? []).flatMap((level) => level.highlights ?? [])] : []).map((highlight) => {
    if (highlight.nodeId) return { why: highlight.why ?? null, node: (data.graph?.nodes ?? []).find((n) => n.id === highlight.nodeId) ?? { id: highlight.nodeId } };
    const [kind, ...rest] = String(highlight.record ?? '').split(':'), id = rest.join(':');
    if (kind === 'event') return { why: highlight.why ?? null, event: id };
    if (kind === 'cut') return { why: highlight.why ?? null, event: (mm.normalized_cuts ?? []).find((c) => c.id === id)?.parent_event_id ?? null, cut: id };
    if (kind === 'event_relation') { const r = (data.relations ?? []).find((x) => x.id === id); return { why: highlight.why ?? null, event: r?.target ?? null, relation: r ?? null }; }
    return { why: highlight.why ?? null, record: highlight.record };
  });
  const tour = () => stops;
  function navigation() {
    const at = !opened ? 'guide' : opened.tour !== undefined ? 'tour' : null;
    const tab = (key, text, target) => el('button', { type: 'button', 'aria-pressed': String(at === key), text, onclick: () => open(target) });
    panelNav.replaceChildren(el('div', { class: 'seg' }, [tab('guide', 'Guide', { kind: 'guide' }), ...(tour().length ? [tab('tour', 'Tour', { kind: 'tour', index: opened?.tour ?? 0 })] : [])]));
  }
  const eyebrow = (text) => el('p', { class: 'cv-eyebrow', text });
  function guide() {
    const rowCount = treeRows.filter((r) => r.kind !== 'group').length;
    const weighed = C.events.filter((e) => e.weighed).length;
    // What the rows drawn can do, said only where their records have it.
    const hasParts = treeRows.some((r) => r.kind === 'measure' && r.children.length);
    const treeNotes = [
      within ? `Opened at ${shown.path.at(-1).label}: only it and the parts it holds are drawn (${rowCount} ${rowCount === 1 ? 'row' : 'rows'}), with the path to it above them. All processes draws the whole tree again.`
        : hasParts ? 'Open, on a process that holds parts, draws only it and its parts, with the path to it above the rows.' : null,
      treeRows.some(stacksParts) ? `A process the model declares as the sum of its parts shows them stacked beneath its curve, in its own unit, adding up to it.${treeRows.some((r) => r.layers?.gap) ? ' Grey is what the whole holds beyond them.' : ''}${treeRows.some((r) => r.layers?.over) ? ' Hatched marks where they add up to more than the whole.' : ''}` : null,
    ].filter(Boolean);
    const items = !showTop ? [`The parts and Events above the time axis are off, so the rows have the whole height. Turn on Events in the controls to show them${C.events.length ? ` (${C.events.length})` : ''}.`,
      `Below the time axis, ${rowCount} rows, each read at the moment under the pointer, with how its value is known.`,
      ...treeNotes,
      C.axis.kind === 'log' ? 'Time is squeezed toward the past: each step to the left covers more time.' : null].filter(Boolean) : [
      whole ? `Across the top: the parts of ${labelOf(whole)}, as the model contains them, each across its own time; parts that overlap share lanes. Open one to widen it and lay out its own parts.`
        : C.wholes.length ? 'Choose an Event under Parts of to lay out its parts across the top.' : null,
      `Then the Events, ${C.events.length} of them${scale() ? `, in rows by how important they are for ${lower(scale().audience ?? words(scale().id))} (${rowsOfEvents.map((r) => `${r.label}: ${r.events.length}`).join('; ')})` : ''}. ${weighed ? `A filled mark is one whose causes the model weighed (${weighed}). ` : ''}Open an Event to draw the links to and from it.`,
      `Below them the time axis, then ${rowCount} rows: ${treeRows.some((r) => r.kind === 'measure') ? 'the processes the model follows, each indented under the process it refines' : ''}${treeRows.some((r) => r.kind === 'cut-series') ? `${treeRows.some((r) => r.kind === 'measure') ? ', and ' : ''}shares the model recorded again and again (Cuts), each reading drawn across the time it averages` : ''}. Each row is read at the moment under the pointer, with how its value is known.`,
      ...treeNotes,
      C.axis.kind === 'log' ? `Time is squeezed toward the past: each step to the left covers more time, so the recent stretch, where most records are, keeps room. An opened part, or a stretch dragged across, is drawn evenly.` : null,
      C.unvalued && !within ? `${C.unvalued} ${C.unvalued === 1 ? 'process has' : 'processes have'} no dated values and no row.` : null,
      pinTop ? 'Pin keeps the parts and Events fixed above the rows while they scroll; turn it off, or turn off Events, to give the rows more height.'
        : 'The parts and Events scroll away as you scroll down the rows, and the time axis stays. Pin keeps them fixed, for a tall screen; turning off Events gives the rows the whole height.',
    ].filter(Boolean);
    return [eyebrow('The Chart'), el('h2', { class: 'cv-title', text: 'How to read this chart' }), el('ul', { class: 'cv-guide' }, items.map((text) => el('li', { text }))),
      chosen ? el('p', { class: 'cv-prose' }, [`The model chose what to show: ${chosen.title}. `, stops.length ? link({ kind: 'tour', index: 0 }, `Take its tour (${stops.length}) →`, 'cv-link cv-strong') : null]) : null];
  }
  function eventPanel(id, tourIndex = null) {
    const e = eventById.get(id) ?? C.byId.get(id) ?? (data.events ?? []).find((x) => x.id === id); const record = modelEvent.get(id);
    if (!e && !record) return [el('p', { text: `This record is not drawn in the Chart: ${id}` })];
    const start = e?.start ?? record?.interval?.start, end = e?.end ?? record?.interval?.end;
    const out = [];
    if (tourIndex !== null) out.push(...tourHead(tourIndex));
    out.push(eyebrow('Event'), el('h2', { class: 'cv-title', text: shortTitle(record?.boundary ?? e.label) }), meta(Number.isFinite(start) ? spanText(start, end) : null, lengthLabel(start, end, C.unit), levelOf(id), e?.region ?? record?.region ?? null), tagLine(record?.provenance));
    if (record?.description ?? e?.text) out.push(para(record?.description ?? e.text));
    for (const q of C.why.get(id) ?? []) {
      out.push(sec(`Why: ${q.contrast ?? q.label}`, para(q.measure ? `Measured as ${q.measure}${Number.isFinite(q.actual) ? `: ${num(q.actual)} as it happened` : ''}.` : null, 'cv-meta'),
        el('ol', { class: 'cv-causes' }, q.ranked.map((c) => el('li', {}, [
          el('div', { class: 'cv-cause-head' }, [link({ kind: 'event', id: c.cause }, shortTitle(c.label ?? fullTitle(c.cause))), c.role ? el('span', { class: 'cv-meta', text: ` ${ROLE_WORDS[c.role] ?? words(c.role)}` }) : null]),
          Number.isFinite(c.without) ? el('div', { class: 'cv-meta', text: `Without it: ${num(c.without)}${c.band ? ` (${num(c.band[0])} to ${num(c.band[1])})` : ''}${Number.isFinite(c.difference) ? ` · difference ${num(c.difference)}` : ''}` }) : null,
          para(c.reason, 'cv-reason')])))));
    }
    if ((C.why.get(id) ?? []).length) out.push(para('The differences do not add up: causes act together, so no cause\'s difference is its share of the whole.', 'cv-note'));
    for (const cut of (mm.normalized_cuts ?? []).filter((c) => c.parent_event_id === id && !c.withdrawn)) {
      const answers = [...(cut.answers ?? [])].sort((a, b) => b.weight - a.weight);
      const inks = answerInks((cut.answers ?? []).map((a) => a.key));
      out.push(sec(cut.question ?? 'How it divides', el('div', { class: 'cv-divided', role: 'img', 'aria-label': answers.map((a) => `${words(a.key)} ${share(a.weight)}`).join(', ') },
        answers.map((a, k) => el('span', { style: `flex:${a.weight};--chip:${inks.get(a.key)}`, title: `${words(a.key)}: ${share(a.weight)}` }))),
        el('ul', { class: 'cv-shares' }, answers.map((a, k) => el('li', {}, [el('span', { class: 'cv-chip', style: `--chip:${inks.get(a.key)}` }),
          a.refers_to?.event_id ? link({ kind: 'event', id: a.refers_to.event_id }, words(a.key)) : el('span', { text: words(a.key) }), el('span', { class: 'cv-meta', text: ` ${share(a.weight)}${cut.unit ? ` of ${cut.unit}` : ''}` })])))));
    }
    const instances = (mm.realizations ?? []).filter((r) => Object.values(r.roles ?? {}).includes(id));
    if (instances.length) out.push(sec('An instance of', el('ul', { class: 'cv-list' }, instances.map((r) => { const concept = (mm.concepts ?? []).find((c) => c.id === r.concept_id); return el('li', {}, [el('strong', { text: concept?.label ?? r.concept_id }), concept?.differentia?.[0] ? el('span', { class: 'cv-meta', text: `: ${concept.differentia[0]}` }) : null]); }))));
    const into = C.links.filter((l) => l.to === id), out2 = C.links.filter((l) => l.from === id);
    if (into.length) out.push(sec('Came from', el('ul', { class: 'cv-list' }, into.map((l) => el('li', {}, [link({ kind: 'event', id: l.from }, shortTitle(fullTitle(l.from))), el('span', { class: 'cv-meta', text: ` ${KIND_WORDS[l.kind] ?? words(l.kind)} it` })])))));
    if (out2.length) out.push(sec('Led to', el('ul', { class: 'cv-list' }, out2.map((l) => el('li', {}, [el('span', { class: 'cv-meta', text: `${capital(KIND_WORDS[l.kind] ?? words(l.kind))} ` }), link({ kind: 'event', id: l.to }, shortTitle(fullTitle(l.to)))])))));
    const moves = (e?.processIds ?? record?.process_ids ?? []).filter((p) => C.tree.rowOf(p));
    if (moves.length) out.push(sec('Moves', el('ul', { class: 'cv-list' }, moves.map((p) => { const there = C.tree.rowOf(p); return el('li', {}, link({ kind: 'row', id: there.id, process: p }, there.label)); }))));
    // Its parts, as the model contains them.
    const parts = C.partsOf(id).sort((a, b) => a.start - b.start);
    if (parts.length) out.push(sec(`Its parts (${parts.length})`, el('ul', { class: 'cv-list' }, parts.map((x) => el('li', {}, [link({ kind: 'event', id: x.id }, shortTitle(x.label)), el('span', { class: 'cv-meta', text: ` ${spanText(x.start, x.end)}` })])))));
    const sources = (record?.provenance ?? []).filter((p) => /^(sources?|checked|sources to check)\b/iu.test(String(p)));
    if (sources.length) out.push(sec('Sources', el('ul', { class: 'cv-list cv-sources' }, sources.map((s) => el('li', { text: String(s) })))));
    return out;
  }
  function rowPanel(id) {
    const row = rowById.get(id); if (!row) return [el('p', { text: `No row: ${id}` })];
    const out = [eyebrow(row.kind === 'cut-series' ? 'Shares over time' : row.kind === 'stack' ? 'Parts of a process' : row.kind === 'group' ? 'Processes' : 'Process'), el('h2', { class: 'cv-title', text: row.label }), meta(row.unit || null, row.holders > 1 ? heldBy(row) : row.holder ? `held by ${row.holder}` : null), para(row.about)];
    if (row.kind === 'measure' && row.children.length && row.process !== within) out.push(el('p', { class: 'cv-actions' }, el('button', { type: 'button', class: 'cv-open cv-open-card', text: 'Open as the top',
      title: `Draw only ${row.label} and the parts it holds`, onclick: () => setTop(row.process, { focus: true }) })));
    if (row.kind === 'measure' && row.series) {
      const points = row.series.points;
      const first = points[0], last = points.at(-1);
      out.push(sec('Recorded values', el('p', { class: 'cv-meta', text: `${points.length} dated values from ${at(first.t, last.t - first.t)} to ${at(last.t, last.t - first.t)}${points.length > 20 ? '; 20 of them, spread across the series' : ''}.` }),
        el('table', { class: 'cv-values' }, [el('tbody', {}, pickPoints(points).map((p) => el('tr', {}, [el('th', { text: at(p.t, last.t - first.t) }), el('td', { text: p.state ? words(p.state) : figure(p.v, row.unit) }),
          el('td', { class: 'cv-meta', text: p.uncertainty?.kind === 'interval' ? `${num(p.uncertainty.lower)} to ${num(p.uncertainty.upper)}` : '' }), el('td', {}, el('span', { class: `cv-tag is-${tagStyle(tagOf(p.tag))}`, text: tagWord(tagOf(p.tag)) }))])))])));
      const movers = (row.series.sourceEventIds ?? []).filter((x) => eventById.has(x) || C.byId.has(x));
      if (movers.length) out.push(sec('Events that move it', el('ul', { class: 'cv-list' }, movers.map((x) => el('li', {}, [link({ kind: 'event', id: x }, shortTitle(fullTitle(x))), el('span', { class: 'cv-meta', text: ` ${at((eventById.get(x) ?? C.byId.get(x)).start, 100)}` })])))));
    }
    if (row.members) out.push(sec(row.kind === 'cut-series' ? 'Its answers' : 'Its parts', el('ul', { class: 'cv-shares' }, row.members.map((m, k) => el('li', {}, [el('span', { class: 'cv-chip', style: `--chip:${inkOf(row, m)}` }),
      m.id && rowOfProcess.has(m.id) ? link({ kind: 'row', id: rowOfProcess.get(m.id).id }, m.label) : el('span', { text: m.label })])))));
    // A process that declares its parts add up to it: the parts stacked beneath its curve, and those it lists without stacking.
    if (row.layers) {
      const { members, listed } = row.layers, name = (x) => (rowOfProcess.has(x.id) ? link({ kind: 'row', id: rowOfProcess.get(x.id).id }, x.label) : el('span', { text: x.label }));
      out.push(sec('Its parts add up to it', para(members.length ? `The model declares this process the sum of its parts. They are stacked beneath its curve, in its own unit${row.layers.gap ? '; grey is what the whole holds beyond them' : ''}${row.layers.over ? '; hatched is where they add up to more than the whole' : ''}.`
        : 'The model declares this process the sum of its parts, but none of them can be stacked here.', 'cv-note'),
        members.length ? el('ul', { class: 'cv-shares' }, members.map((m) => el('li', {}, [el('span', { class: 'cv-chip', style: `--chip:${inkOf(row, m)}` }), name(m)]))) : null,
        row.layers.exceeds.length ? para(`At ${row.layers.exceeds.length} recorded ${row.layers.exceeds.length === 1 ? 'date' : 'dates'} the parts add up to more than the whole: ${row.layers.exceeds.slice(0, 8)
          .map((x) => `${at(x.t, Infinity)}, by ${figure(x.by, row.unit)}${x.inRange ? ' (within the range it states)' : ''}`).join('; ')}${row.layers.exceeds.length > 8 ? `; and ${row.layers.exceeds.length - 8} more` : ''}.`, 'cv-note') : null,
        listed.length ? [el('p', { class: 'cv-meta', text: 'Listed, not stacked:' }), el('ul', { class: 'cv-list' }, listed.map((x) => el('li', {}, [name(x), el('span', { class: 'cv-meta', text: ` ${x.why}` })])))] : null));
    }
    if (row.kind === 'cut-series') out.push(para(`${row.members[0]?.points.length ?? 0} readings, each the average over the time it covers. The remainder is what the answers leave open.`, 'cv-note'));
    // The row above it: in the rows drawn, or, for the top that was opened, the process it was opened from.
    const parent = row.parent ? rowById.get(row.parent) : row.up ? C.tree.rowOf(row.up) : null;
    const tree = [parent ? el('li', {}, [el('span', { class: 'cv-meta', text: 'Part of ' }), link({ kind: 'row', id: parent.id, process: parent.process }, parent.label)]) : null,
      ...(row.alsoUnder ?? []).map((p) => el('li', {}, [el('span', { class: 'cv-meta', text: 'Also part of ' }), el('span', { text: C.tree.rowOf(p)?.label ?? rowById.get(p)?.label ?? p })])),
      ...row.children.map((c) => el('li', {}, [el('span', { class: 'cv-meta', text: 'Divides into ' }), link({ kind: 'row', id: c }, rowById.has(c) ? rowName(rowById.get(c)) : c)]))].filter(Boolean);
    if (tree.length) out.push(sec('In the tree', el('ul', { class: 'cv-list' }, tree)));
    return out;
  }
  // A long series is listed by about twenty of its values spread across it, always with its first and last; the chart
  // and the Numbers of the other views hold every one.
  function pickPoints(points, most = 20) {
    if (points.length <= most) return points;
    const keep = new Set(Array.from({ length: most }, (_, k) => Math.round((k * (points.length - 1)) / (most - 1))));
    return [...keep].sort((a, b) => a - b).map((i) => points[i]);
  }
  // A stop on the model's tour: where it is in the tour, and the model's reason for showing it.
  function tourHead(index) {
    const stop = stops[index];
    return [el('p', { class: 'cv-tour-bar' }, [index > 0 ? link({ kind: 'tour', index: index - 1 }, '← Previous') : el('span'), el('span', { text: `${index + 1} of ${stops.length}` }),
      index < stops.length - 1 ? link({ kind: 'tour', index: index + 1 }, 'Next →') : el('span')]),
      eyebrow(`The model's tour · ${chosen.title}`), stop?.why ? el('p', { class: 'cv-prose cv-why' }, stop.why) : null,
      stop?.relation ? meta(`The link: ${shortTitle(fullTitle(stop.relation.source))} ${KIND_WORDS[stop.relation.kind] ?? words(stop.relation.kind)} ${shortTitle(fullTitle(stop.relation.target))}`) : null].filter(Boolean);
  }
  function stopPanel(index) {
    const stop = stops[index];
    if (stop?.event) return eventPanel(stop.event, index);
    if (stop?.node) return [...tourHead(index), eyebrow('Note'), el('h2', { class: 'cv-title', text: stop.node.title || stop.node.id }), para(stop.node.text)];
    return [...tourHead(index), meta(stop?.record ?? '')];
  }
  function groupPanel(ids) {
    const list = ids.map((x) => eventById.get(x)).filter(Boolean).sort((a, b) => a.start - b.start);
    return [eyebrow('Events'), el('h2', { class: 'cv-title', text: `${list.length} Events close together` }), meta(list.length ? spanText(list[0].start, list.at(-1).start) : null),
      el('ul', { class: 'cv-list' }, list.map((x) => el('li', {}, [link({ kind: 'event', id: x.id }, shortTitle(x.label)), el('span', { class: 'cv-meta', text: ` ${at(x.start, x.end - x.start)}${levelOf(x.id) ? ` · ${levelOf(x.id)}` : ''}${x.weighed ? ' · causes weighed' : ''}` })])))];
  }
  function showOpened() {
    navigation();
    let content;
    if (!opened || opened.kind === 'guide') content = guide();
    else if (opened.tour !== undefined) content = stopPanel(opened.tour);
    else if (opened.kind === 'event') content = eventPanel(opened.id);
    else if (opened.kind === 'row') content = rowPanel(opened.id);
    else if (opened.kind === 'group') content = groupPanel(opened.ids);
    panelBody.replaceChildren(...[opened && opened.kind !== 'guide' ? el('p', { class: 'cv-back' }, link({ kind: 'guide' }, '← How to read this chart')) : null, ...content].filter(Boolean));
    panelBody.scrollTop = 0;
  }

  // ---- opening: the chart follows what is open, and the selection is shared with the other views -----------------------------------
  // What holds an Event, as declared: it and the Events containing it, nearest first.
  const parentOf = new Map((data.events ?? []).map((e) => [e.id, e.parent ?? null]));
  const lineage = (id) => { const out = []; for (let at = id, hops = 0; at && hops < 256; at = parentOf.get(at), hops += 1) out.push(at); return out; };
  function open(target, { share = true, pin = true } = {}) {
    if (target.kind === 'tour') { const stop = stops[target.index]; target = stop ? { kind: stop.event ? 'event' : 'note', id: stop.event ?? null, tour: target.index } : { kind: 'guide' }; }
    if (target.kind === 'row' && target.process && !rowById.has(target.id)) widenFor(target.process);
    opened = target.kind === 'guide' ? null : target;
    if (opened && panel.hidden) showPanel(true);
    const id = opened?.id;
    for (const v of rowViews) v.node.classList.toggle('is-selected', opened?.kind === 'row' && v.row.id === id);
    if (opened?.kind === 'event' && id) {
      // Opening an Event widens the part across the top that it is, or that contains it; a part of the whole also lays
      // out its own parts beneath it. Nothing is widened by time alone.
      const chain = lineage(id), e = eventById.get(id) ?? C.byId.get(id);
      const top = chain.find((x) => bandParts.some((p) => p.level === 0 && p.id === x)) ?? null;
      if (top && top !== openPart) { openPart = top; layoutParts(); buildBands(); relayout(true); }
      const holder = chain.map((x) => bandParts.find((p) => p.id === x && (p.level === 1 || x === top))).find(Boolean) ?? null;
      setFocus(holder);
      if (e && pin) { pinT = e.start; if (share) pinnedHere = true; }
      if (share) onSelect({ kind: 'event', id });
    } else if (opened?.kind === 'row') {
      let p = rowById.get(id)?.parent, unfolded = false;
      while (p) { if (collapsed.has(p)) { collapsed.delete(p); unfolded = true; } p = rowById.get(p)?.parent; }
      if (unfolded) { applyCollapsed(); drawRows(true); }
      const view = viewById.get(id);
      if (view) { const topY = view.node.offsetTop - L.headH - 12; if (topY < scroller.scrollTop || topY > scroller.scrollTop + scroller.clientHeight - L.headH - 80) scroller.scrollTo({ top: Math.max(0, topY), behavior: reducedMotion.matches ? 'auto' : 'smooth' }); }
      const process = rowById.get(id)?.process;
      if (share && process) onSelect({ kind: 'process', id: process });
    } else if (!opened && share) onSelect(null);
    drawHead();
    showOpened();
  }

  // ---- the accordion ---------------------------------------------------------------------------------------------------------------
  function render() { drawHead(); drawRows(); }
  function animateTo(next) {
    const current = { from: scaleFrom, to: scaleTo, mix };
    scaleFrom = (t) => (current.mix >= 1 ? current.to(t) : current.from(t) * (1 - current.mix) + current.to(t) * current.mix);
    scaleTo = next; mix = 0;
    computeUnits();
    cancelAnimationFrame(animation);
    if (reducedMotion.matches || document.hidden || !active) { mix = 1; render(); return; }
    const begin = performance.now(), duration = 680;
    const step = (now) => { const x = Math.min(1, (now - begin) / duration); mix = x >= 1 ? 1 : 1 - 2 ** (-10 * x); render(); if (x < 1) animation = requestAnimationFrame(step); };
    animation = requestAnimationFrame(step);
  }
  function setFocus(next) { if (next === focus) return; focus = next; zoomOut.hidden = !focus; animateTo(makeScale(focus)); }
  function relayout(force = false) {
    if (!active) return;
    const next = measure(); const changed = force || !L || next.width !== L.width || next.headH !== L.headH;
    L = next; if (changed) { computeUnits(); render(); } else placeOverlays();
  }
  const resizeObserver = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => relayout()); });
  resizeObserver.observe(chart);
  const keys = (event) => {
    if (!active || event.defaultPrevented || event.target.closest?.('input, textarea, select')) return;
    if (event.key === 'Escape' && (opened || focus)) { event.preventDefault(); if (opened) open({ kind: 'guide' }); else setFocus(null); }
  };
  addEventListener('keydown', keys);

  return {
    activate(_view, state = {}) {
      active = true; root.hidden = false;
      for (const node of controls) node.hidden = false;
      zoomOut.hidden = !focus;
      if (state.chart?.top !== undefined && Boolean(state.chart.top) !== showTop) applyTop(Boolean(state.chart.top));
      if (state.chart?.pin !== undefined) { pinTop = Boolean(state.chart.pin); pinButton.setAttribute('aria-pressed', String(pinTop)); }
      pinButton.hidden = !showTop;
      // A time set in another view is where the rows are read, before they are drawn.
      let timeGiven = false;
      if (state.time) {
        sharedTime = { ...state.time }; pinnedHere = false;
        const at0 = state.time.now;
        if (Number.isFinite(at0) && at0 >= C.axis.start && at0 <= C.axis.end) { pinT = at0; timeGiven = true; }
      }
      L = measure(); computeUnits(); render();
      if (state.chart) {
        if (state.chart.scale && C.scaleChoices.some((s) => s.id === state.chart.scale) && state.chart.scale !== scaleId) { scaleId = state.chart.scale; rowsOfEvents = C.eventRows(scaleId); L = measure(); computeUnits(); render(); }
        if (state.chart.reading === false) showPanel(false);
        if (state.chart.links !== undefined) { showAllLinks = Boolean(state.chart.links); linksButton.setAttribute('aria-pressed', String(showAllLinks)); }
      }
      // The shared selection: an Event or process the Chart draws is opened (a process in the row already open for it,
      // when one is); a selection cleared elsewhere, or one the Chart cannot show, leaves the guide. Nothing is sent back.
      const wanted = state.selection;
      if (wanted?.kind === 'process') widenFor(wanted.id);
      const processRow = wanted?.kind === 'process' ? (opened?.kind === 'row' && rowById.get(opened.id)?.process === wanted.id ? rowById.get(opened.id) : rowOfProcess.get(wanted.id)) : null;
      if (wanted?.kind === 'event' && (eventById.has(wanted.id) || C.byId.has(wanted.id))) open({ kind: 'event', id: wanted.id }, { share: false, pin: !timeGiven });
      else if (processRow) open({ kind: 'row', id: processRow.id }, { share: false });
      else if (wanted !== undefined && opened) open({ kind: 'guide' }, { share: false });
      else if (!opened) showOpened();
      else { drawHead(); showOpened(); }
    },
    deactivate() { active = false; cancelAnimationFrame(animation); for (const node of controls) node.hidden = true; },
    // The moment pinned here enters the shared time as time.now, the rest of the time received kept; without one the
    // shared time stays as it was. A pinned moment is story time, and no longer the end the time views follow.
    getState() {
      const time = pinnedHere && Number.isFinite(pinT) ? { ...sharedTime, mode: 'story', now: pinT, atEnd: false } : null;
      return { chart: { scale: scaleId, links: showAllLinks, reading: !panel.hidden, top: showTop, pin: pinTop }, ...(time ? { time } : {}) };
    },
    recenter() { setFocus(null); scroller.scrollTo({ top: 0 }); },
    // A stretch of time found by search takes most of the axis, as a dragged stretch does, and the rows are read just
    // inside its end.
    zoomTo(start, end) {
      const a = Math.max(C.axis.start, Math.min(start, end)), b = Math.min(C.axis.end, Math.max(start, end));
      if (!(b > a)) return false;
      pinT = b - (b - a) * 0.001; pinnedHere = true; setFocus({ id: null, start: a, end: b }); placeOverlays();
      return true;
    },
    destroy() { active = false; resizeObserver.disconnect(); io.disconnect(); removeEventListener('keydown', keys); removeEventListener('pointermove', onDragMove); removeEventListener('pointerup', onDragEnd); cancelAnimationFrame(animation); for (const node of controls) node.remove(); surface.replaceChildren(); },
  };
}
