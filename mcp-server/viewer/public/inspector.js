// Read stored records without turning model-relative clocks or initial values into a calendar timeline.
const text = (tag, value, className) => {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
};
const words = (value) => String(value).replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
const json = (value) => JSON.stringify(value, null, 2);

function definition(label, value) {
  const details = document.createElement('details'); details.className = 'inspection-record';
  details.append(text('summary', label));
  details.addEventListener('toggle', () => {
    if (details.open && !details.querySelector('pre')) details.append(text('pre', json(value)));
  });
  return details;
}

export function showInspector(data, notice = null) {
  if (!document.querySelector('link[data-inspector]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'inspector.css'; css.dataset.inspector = '';
    document.head.append(css);
  }
  document.body.className = 'inspector';
  const main = document.createElement('main'); main.className = 'inspection-content';
  document.body.replaceChildren(main);
  const model = data?.inspection?.model ?? {};
  const title = data?.title ?? model.id ?? 'Meaning Model';
  document.title = title;
  main.append(text('p', 'Meaning Model · read-only snapshot', 'inspection-eyebrow'), text('h1', title));
  if (notice) main.append(text('p', notice, 'inspection-notice'));
  if (!data) return;
  main.append(text('p', 'Inspect the model’s stored records, relationships and accompanying notes. Open a record to read its full definition.'),
    text('p', `Time unit: ${(model.time_unit ?? data.timeUnit) || 'not declared'}. Intervals use that unit; initial values are labeled in their definitions.`, 'inspection-meta'));
  if (data.modelHash) main.append(text('p', `Model: ${data.modelHash}`, 'inspection-meta'));
  if (data.headGraphHash) main.append(text('p', `Graph: ${data.headGraphHash}`, 'inspection-meta'));

  const groups = [];
  for (const [key, records] of Object.entries(model)) if (Array.isArray(records) && records.length) groups.push({ label: words(key), records });
  for (const [key, records] of Object.entries(model.meaning_model ?? {})) if (Array.isArray(records) && records.length) groups.push({ label: words(key), records });
  const graph = data.inspection?.graph ?? data.graph ?? {};
  if (graph.nodes?.length) groups.push({ label: 'Understanding graph records', records: graph.nodes });
  if (graph.edges?.length) groups.push({ label: 'Understanding graph links', records: graph.edges });

  const navigation = document.createElement('nav'); navigation.className = 'inspection-nav'; navigation.setAttribute('aria-label', 'Model collections');
  const story = (data.story?.units ?? []).filter((unit) => unit.text?.trim());
  if (story.length) { const link = text('a', 'Rendered document'); link.href = '#rendered-document'; navigation.append(link); }
  for (const [index, group] of groups.entries()) {
    const link = text('a', `${group.label} (${group.records.length})`); link.href = `#collection-${index}`; navigation.append(link);
  }
  main.append(navigation);
  if (story.length) {
    const section = document.createElement('section'); section.id = 'rendered-document'; section.append(text('h2', 'Rendered document'));
    for (const unit of story) section.append(text('div', unit.text, 'inspection-prose'));
    main.append(section);
  }
  for (const [index, group] of groups.entries()) {
    const section = document.createElement('section'); section.id = `collection-${index}`;
    section.append(text('h2', `${group.label} · ${group.records.length}`));
    for (const [position, record] of group.records.entries()) {
      const id = record?.id ?? record?.event_id ?? `Record ${position + 1}`;
      const description = record?.label ?? record?.title ?? record?.boundary ?? record?.question ?? '';
      section.append(definition(description && description !== id ? `${id} — ${description}` : String(id), record));
    }
    main.append(section);
  }
  if (!groups.length) main.append(text('p', 'This snapshot has no records in its collections.'));
  main.append(definition('Complete model definition', model));
}
