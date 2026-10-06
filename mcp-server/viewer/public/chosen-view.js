// The card that says the model chose what the view shows: the view's title and caption, the levels of detail a reader
// turns up through, what it highlights and why, and the way to the reader's own settings or back to the model's view.
// The address says which view it follows (see view-settings.js); this card reads it and keeps it current.
import { currentView, everythingLevel, levelCount, sameSettings, viewAddress } from './view-settings.js';
import { isCalendarTime } from './temporal-layout.js';

// The settings the view opened with, as the viewer first wrote them: a reader who changes any of them has adjusted the
// model's view, and the address says so.
let baseline = null;
export function noteAddress(location = globalThis.location, history = globalThis.history) {
  const url = new URL(location.href), chosen = url.searchParams.get('chosen');
  if (!chosen || chosen === 'none' || url.searchParams.has('adjusted')) return false;
  if (baseline === null) { baseline = url.search; return false; }
  if (sameSettings(baseline, url.search)) return false;
  url.searchParams.set('adjusted', '');
  history.replaceState(null, '', url.href.replace(/([?&]adjusted)=(&|$)/u, '$1$2'));
  globalThis.dispatchEvent?.(new Event('chosen-view-change'));
  return true;
}

const clip = (text, n) => { const s = String(text ?? '').replace(/\s+/gu, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
// A moment's name is its first sentence, when that is short enough to read at a glance.
const firstSentence = (text, n) => { const s = String(text ?? '').replace(/\s+/gu, ' ').trim(), end = s.search(/[.!?](\s|$)/u); return clip(end > 0 && end < n ? s.slice(0, end) : s, n); };
// What a highlight names, in the reader's words: a note's title, a moment's name, a reading's question and when, and a
// link as the one moving the other.
export function highlightName(data, target) {
  if (target.nodeId) { const node = (data.graph?.nodes ?? []).find((item) => item.id === target.nodeId); return clip(node?.title || node?.text || target.nodeId, 90); }
  const [kind, ...rest] = String(target.record).split(':'), id = rest.join(':');
  const calendar = isCalendarTime(data.timeUnit), when = (t) => (Number.isFinite(t) ? (calendar ? String(Math.floor(t)) : t.toFixed(1)) : '');
  const reading = (cut) => `${clip(cut.question, 64)}${when(cut.t) ? `, ${when(cut.t)}` : ''}`;
  const name = (eventId, n) => {
    const event = (data.events ?? []).find((item) => item.id === eventId); if (event) return firstSentence(event.label, n);
    // A reading Event can carry several Cuts when a series opens one answer of another; the reading is the undivided one.
    const cuts = (data.numerics?.cuts ?? []).filter((item) => item.parentEventId === eventId), cut = cuts.find((item) => !item.conditioning) ?? cuts[0];
    return cut ? reading(cut) : eventId;
  };
  if (kind === 'event') return name(id, 90);
  if (kind === 'event_relation') { const relation = (data.relations ?? []).find((item) => item.id === id); return relation ? `${name(relation.source, 52)} → ${name(relation.target, 52)}` : id; }
  if (kind === 'cut') { const cut = (data.numerics?.cuts ?? []).find((item) => item.id === id); return cut ? reading(cut) : id; }
  return id;
}
export const levelNames = (view) => ['The view', ...(view.levels ?? []).map((level) => level.label), 'Everything'];
// Whether a highlight's record is still in this snapshot: a later revision can remove what an earlier view named.
export function highlightPresent(data, target) {
  if (target.nodeId) return (data.graph?.nodes ?? []).some((item) => item.id === target.nodeId);
  const [kind, ...rest] = String(target.record).split(':'), id = rest.join(':');
  const cuts = data.numerics?.cuts ?? [];
  if (kind === 'event') return (data.events ?? []).some((item) => item.id === id) || cuts.some((item) => item.parentEventId === id);
  if (kind === 'event_relation') return (data.relations ?? []).some((item) => item.id === id);
  if (kind === 'cut') return cuts.some((item) => item.id === id);
  return false;
}

export function mountChosenView({ data, opening, onHighlight = () => {}, document = globalThis.document, location = globalThis.location } = {}) {
  const views = data?.views ?? [], current = currentView(views);
  if (!current) return null;
  const card = document.createElement('section'); card.className = 'chosen-view'; card.id = 'chosen-view'; card.setAttribute('aria-label', 'The view the model chose');
  (document.getElementById('tools') ?? document.body).after(card);
  const go = (href) => location.assign(href);
  const own = () => { const url = new URL(location.href); for (const key of ['chosen', 'level', 'adjusted']) url.searchParams.delete(key); url.searchParams.set('chosen', 'none'); go(url.href); };
  let justChanged = opening.state === 'changed', folded = false;
  function render() {
    const address = new URL(location.href), adjusted = address.searchParams.has('adjusted');
    const state = opening.state === 'own' || opening.state === 'none' ? 'own' : adjusted ? 'adjusted' : 'following';
    const view = state === 'own' ? current : opening.view ?? current;
    card.replaceChildren(); card.dataset.state = state; card.classList.toggle('just-changed', justChanged);
    // One detail control at a time: on the model's view its levels are the detail, so the toolbar's subprocess stepper
    // and Coarse wait until the reader turns to their own settings.
    for (const id of ['detail-stepper', 'coarse-view']) { const control = document.getElementById(id); if (control) control.hidden = state !== 'own'; }
    const head = document.createElement('div'); head.className = 'chosen-head';
    const eyebrow = document.createElement('span'); eyebrow.className = 'chosen-eyebrow';
    eyebrow.textContent = state === 'own' ? 'Your own settings' : justChanged ? 'The model just changed this view' : adjusted ? 'Chosen by the model · adjusted by you' : 'Chosen by the model';
    head.append(eyebrow);
    if (state !== 'own') {
      const fold = document.createElement('button'); fold.type = 'button'; fold.className = 'chosen-fold'; fold.textContent = folded ? '+' : '−';
      fold.setAttribute('aria-expanded', String(!folded)); fold.title = folded ? 'Show the model\'s view card' : 'Fold the card';
      fold.addEventListener('click', () => { folded = !folded; render(); }); head.append(fold);
    }
    const title = document.createElement('h2'); title.className = 'chosen-title'; title.textContent = view.title;
    card.append(head, title);
    if (state === 'own') {
      const note = document.createElement('p'); note.className = 'chosen-caption'; note.textContent = `The model chose a view: ${clip(current.caption, 160)}`;
      const show = document.createElement('button'); show.type = 'button'; show.className = 'tool'; show.textContent = 'Show the model\'s view';
      show.addEventListener('click', () => go(viewAddress(location.href, current)));
      card.append(note, show); return;
    }
    if (folded) return;
    const caption = document.createElement('p'); caption.className = 'chosen-caption'; caption.textContent = view.caption; card.append(caption);
    if (state === 'adjusted' && opening.newer) {
      const newer = document.createElement('button'); newer.type = 'button'; newer.className = 'tool chosen-newer'; newer.textContent = 'The model chose a new view · show it';
      newer.addEventListener('click', () => go(viewAddress(location.href, current))); card.append(newer);
    }
    // Detail: the view itself, then each level the model labelled, then Everything.
    const names = levelNames(view), level = Math.min(opening.level ?? 0, everythingLevel(view));
    const levels = document.createElement('div'); levels.className = 'chosen-levels';
    const label = document.createElement('label'); label.className = 'chosen-level-label';
    const word = document.createElement('i'); word.textContent = 'Detail'; const name = document.createElement('b'); name.textContent = names[level];
    label.append(word, ' ', name);
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = String(levelCount(view) - 1); slider.step = '1'; slider.value = String(level);
    slider.setAttribute('aria-label', 'Detail'); slider.setAttribute('aria-valuetext', names[level]);
    slider.addEventListener('input', () => { name.textContent = names[Number(slider.value)]; slider.setAttribute('aria-valuetext', names[Number(slider.value)]); });
    slider.addEventListener('change', () => go(viewAddress(location.href, view, Number(slider.value))));
    const stops = document.createElement('ol'); stops.className = 'chosen-stops';
    names.forEach((text, index) => {
      const stop = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.classList.toggle('on', index === level); button.setAttribute('aria-pressed', String(index === level));
      button.addEventListener('click', () => { if (index !== level) go(viewAddress(location.href, view, index)); });
      stop.append(button); stops.append(stop);
    });
    label.htmlFor = slider.id = 'chosen-level';
    levels.append(label, slider, stops); card.append(levels);
    // What to notice: the highlights up to this level, what the level added first, each with why it matters; picking
    // one opens it.
    const groups = [{ label: names[0], highlights: view.highlights ?? [] }, ...(view.levels ?? []).slice(0, level).map((item) => ({ label: item.label, highlights: item.highlights ?? [] }))]
      .filter((group) => group.highlights.length).reverse();
    if (level < everythingLevel(view) && groups.length) {
      const heading = document.createElement('h3'); heading.textContent = 'What to notice'; card.append(heading);
      for (const group of groups) {
        if (groups.length > 1) { const sub = document.createElement('h4'); sub.textContent = group.label; card.append(sub); }
        const list = document.createElement('ul'); list.className = 'chosen-highlights';
        for (const target of group.highlights) {
          const item = document.createElement('li'); const pick = document.createElement('button'); pick.type = 'button'; pick.textContent = highlightName(data, target);
          if (highlightPresent(data, target)) pick.addEventListener('click', () => onHighlight(target));
          else { pick.disabled = true; pick.textContent += ' · no longer in the model'; item.classList.add('gone'); }
          const reason = document.createElement('span'); reason.textContent = target.why; item.append(pick, reason); list.append(item);
        }
        card.append(list);
      }
    }
    const actions = document.createElement('div'); actions.className = 'chosen-actions';
    if (adjusted) { const back = document.createElement('button'); back.type = 'button'; back.className = 'tool'; back.textContent = 'Back to the model\'s view'; back.addEventListener('click', () => go(viewAddress(location.href, view, level))); actions.append(back); }
    const mine = document.createElement('button'); mine.type = 'button'; mine.className = 'tool'; mine.textContent = 'Your own settings';
    mine.title = 'Leave the model\'s view: every row, link and note by your own settings'; mine.addEventListener('click', own); actions.append(mine);
    card.append(actions);
  }
  render();
  globalThis.dispatchEvent?.(new Event('resize')); // the scene makes room for the card
  // The marker that the model just changed the view stays until the reader has seen it and acts.
  if (justChanged) {
    const settle = () => { justChanged = false; render(); for (const type of ['pointerdown', 'keydown', 'wheel']) globalThis.removeEventListener?.(type, settle, true); };
    setTimeout(() => { for (const type of ['pointerdown', 'keydown', 'wheel']) globalThis.addEventListener?.(type, settle, true); }, 1_500);
  }
  globalThis.addEventListener?.('chosen-view-change', render);
  // Picking a highlight folds the card to its title, so the panel that opens beside the scene is not under it.
  return { render, element: card, fold: (on = true) => { if (folded !== on) { folded = on; render(); globalThis.dispatchEvent?.(new Event('resize')); } } };
}
