// What the view needs besides itself: which run to open, the links it names, and what a process is called.

// The run named by ?data=, else the one an agent worked on last. Without one, the page says how to open a run.
export async function loadData(params) {
  let name = params.get('data');
  if (!name) {
    try { const index = await (await fetch('data/index.json', { cache: 'no-store' })).json(); name = [...(index.runs ?? [])].sort((a, b) => String(b.lastCall ?? '').localeCompare(String(a.lastCall ?? '')))[0]?.name ?? index.default; }
    catch { name = null; }
  }
  const response = name ? await fetch(`data/${encodeURIComponent(name)}.json?ts=${Date.now()}`, { cache: 'no-store' }).catch(() => null) : null;
  if (!response?.ok) {
    const note = document.createElement('p'); note.style.cssText = 'position:fixed;inset:40% 0 auto;text-align:center;color:#c3c2b7;font:16px system-ui,sans-serif;z-index:9';
    note.textContent = 'This model snapshot is unavailable. Ask the assistant to open the model again.';
    document.body.append(note);
    throw new Error(note.textContent);
  }
  return { name, data: await response.json() };
}

// The links a view shows: the run's own (its viewer.json), then this viewer and the Meaning Model.
export const VIEWER = { label: 'This view', url: 'https://github.com/emergent-wisdom/meaning-model-viewer' };
export const TOOL = { label: 'The tool', url: 'https://github.com/emergent-wisdom/meaning-model' };
export const linksOf = (data) => [...(data.display?.links ?? []).filter((link) => /^https?:\/\//.test(link.url ?? '')), VIEWER, TOOL]
  .filter((link, i, all) => all.findIndex((other) => other.url === link.url) === i);
export function fillLinks(element, data) {
  if (!element) return;
  element.replaceChildren();
  for (const link of linksOf(data)) {
    const label = document.createElement('span'); label.textContent = link.label;
    const anchor = document.createElement('a'); anchor.href = link.url; anchor.textContent = link.url.replace(/^https?:\/\//, ''); element.append(label, anchor);
  }
}

// Model names are text, including when they contain markup. Keep them out of the legend's HTML templates.
export function appendLegendNames(element, entries) {
  const document = element.ownerDocument;
  const row = document.createElement('div');
  row.className = 'key-row'; row.style.cssText = 'gap:12px;flex-wrap:wrap';
  for (const [name, hue] of entries) {
    const label = document.createElement('span');
    label.style.cssText = 'display:inline-flex;align-items:center;gap:6px';
    const marker = document.createElement('i');
    marker.style.cssText = 'width:10px;height:10px;border-radius:50%;display:inline-block';
    marker.style.background = hue;
    label.append(marker, document.createTextNode(String(name)));
    row.append(label);
  }
  element.append(row);
}

// A process's name: the run's own name for it (display.names in viewer.json), else its id as words, without the first
// name of the person it belongs to.
export function processLabel(data, id) {
  if (data.display?.names?.[id]) return data.display.names[id];
  const parts = String(id).split('.'); const firstNames = new Set((data.people ?? []).map((person) => String(person.name ?? '').split(' ')[0].toLowerCase()));
  return (parts.length > 1 && firstNames.has(parts[0].toLowerCase()) ? parts.slice(1) : parts).join(' ').replace(/_/g, ' ');
}

// Whose a lens reading is, in words: the holder it sits beneath, or that the model does not say.
export function holderText(reading, people = []) {
  const person = (id) => people.find((item) => item.id === id)?.name ?? String(id ?? '').split('.').at(-1);
  if (reading.perspective === 'actor') return `${person(reading.holder)}'s own reasons, as canon`;
  if (reading.perspective === 'reader') return `${person(reading.holder)}'s reading`;
  if (reading.holder) return reading.placed ? `read by ${reading.holder}` : `read by ${reading.holder}, kept on the record it reads`;
  return 'whose reading this is, the model does not say';
}
