// Read native records without fabricating a clock, trajectory or decomposition.
import { buildStructureIndex, formatModelInterval } from './structure-model.js';
import { buildModelGraph } from './model-graph.js';
const text = (tag, value, className) => {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
};
const words = (value) => String(value).replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
const json = (value) => JSON.stringify(value, null, 2);
const labelOf = (record) => record?.label || record?.title || record?.boundary || record?.question || record?.id || 'Unresolved record';
function lazy(label, populate, className = 'inspection-record') {
  const details = document.createElement('details'); details.className = className;
  details.append(typeof label === 'string' ? text('summary', label) : label);
  let populated = false;
  details.addEventListener('toggle', () => {
    if (details.open && !populated) { populated = true; populate(details); }
  });
  return details;
}
function definition(label, value) { return lazy(label, (details) => details.append(text('pre', json(value)))); }
function badge(value) { return text('span', value, 'inspection-badge'); }
function listSection(title, items) {
  const section = document.createElement('div'); section.className = 'inspection-branch';
  section.append(text('h4', title), ...items); return section;
}

export function proseUnit(source) {
  const article = document.createElement('article'); article.className = 'inspection-prose';
  let paragraph = [];
  const flush = () => { if (paragraph.length) article.append(text('p', paragraph.join(' '))); paragraph = []; };
  for (const line of source.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flush(); article.append(text(`h${heading[1].length}`, heading[2])); }
    else if (!line.trim()) flush();
    else paragraph.push(line.trim());
  }
  flush(); return article;
}

function structureView(model, onSelect = () => {}) {
  const index = buildStructureIndex(model), registry = new Map();
  const key = (kind, id) => `${kind}:${id}`;
  function reference(kind, id, context = 'Shared reference') {
    const wrapper = text('div', `${context} · ${id}`, 'inspection-reference');
    const target = registry.get(key(kind, id));
    if (target) {
      const button = text('button', 'Go to record'); button.type = 'button';
      button.addEventListener('click', () => {
        for (let node = target; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
        target.scrollIntoView({ block: 'center' }); target.querySelector('summary')?.focus();
      });
      wrapper.append(button);
    }
    return wrapper;
  }
  function cutNode(cut, path = new Set()) {
    if (!cut) return text('p', 'Unresolved Cut', 'inspection-reference');
    if (path.has(cut.id)) return reference('cut', cut.id, 'Cycle reference');
    if (registry.has(key('cut', cut.id))) return reference('cut', cut.id, 'Conditional / shared Cut reference');
    const summary = text('summary', labelOf(cut));
    summary.addEventListener('click', () => onSelect({ kind: 'normalized_cut', id: cut.id }));
    summary.append(badge(`Cut · ${cut.unit ?? 'unit not declared'}`));
    const details = lazy(summary, (container) => {
      const body = document.createElement('div'); body.className = 'inspection-body';
      body.append(text('p', cut.id, 'inspection-meta'), text('p', `Owning Event: ${cut.parent_event_id}`, 'inspection-meta'));
      if (cut.conditioning) body.append(text('p', `Conditional on ${cut.conditioning.cut_id} → ${cut.conditioning.answer_key}. Weights apply within that answer; they are not multiplied into an overall score.`, 'inspection-meta'));
      body.append(text('p', `Declared answer weights · ${cut.unit ?? 'unit not declared'}. Remainder is shown when authored.`, 'inspection-meta'));
      const answers = document.createElement('ul'); answers.className = 'inspection-answers';
      const nextPath = new Set(path).add(cut.id), childGroups = index.conditionedCuts.get(cut.id) ?? new Map();
      for (const answer of cut.answers ?? []) {
        const row = document.createElement('li');
        row.append(text('span', answer.key), text('strong', answer.weight == null ? 'No weight declared' : String(answer.weight), 'inspection-weight'));
        const children = childGroups.get(answer.key) ?? [];
        if (children.length) row.append(listSection(`Conditional Cuts · ${children.length}`, children.map((child) => cutNode(child, nextPath))));
        answers.append(row);
      }
      body.append(answers);
      const unresolved = [...childGroups].filter(([answer]) => !(cut.answers ?? []).some((entry) => entry.key === answer));
      for (const [answer, children] of unresolved) body.append(listSection(`Unresolved conditioning answer: ${answer}`, children.map((child) => cutNode(child, nextPath))));
      body.append(definition('Raw Cut definition', cut)); container.append(body);
    });
    registry.set(key('cut', cut.id), details); return details;
  }
  function node(kind, id, path = new Set(), inheritedContexts = []) {
    const isEvent = kind === 'event', records = isEvent ? index.events : index.processes, record = records.get(id);
    if (!record) return text('p', `Unresolved ${kind} reference · ${id}`, 'inspection-reference');
    if (path.has(id)) return reference(kind, id, 'Cycle reference');
    if (registry.has(key(kind, id))) return reference(kind, id);
    const children = (isEvent ? index.eventChildren : index.processChildren).get(id) ?? [];
    const parents = (isEvent ? index.eventParents : index.processParents).get(id) ?? [];
    const cuts = isEvent ? index.cutsByEvent.get(id) ?? [] : [];
    const contexts = isEvent ? index.contexts.get(id) ?? inheritedContexts : [];
    const summary = text('summary', labelOf(record));
    summary.addEventListener('click', () => onSelect({ kind, id }));
    summary.append(badge(isEvent ? 'Event' : 'Process'));
    if (children.length) summary.append(badge(`${children.length} ${isEvent ? 'contained' : 'decomposed'} children`));
    if (cuts.length) summary.append(badge(`${cuts.length} Cuts`));
    if (parents.length > 1) summary.append(badge(`${parents.length} parents · shared`));
    for (const context of contexts) summary.append(badge(`Context: ${words(context.kind)}`));
    const details = lazy(summary, (container) => {
      const body = document.createElement('div'); body.className = 'inspection-body';
      body.append(text('p', id, 'inspection-meta'));
      if (isEvent) {
        body.append(text('p', formatModelInterval(record.interval, model.time_unit), 'inspection-meta'));
        if (record.description && record.description !== labelOf(record)) body.append(text('p', record.description));
        if (cuts.length) {
          // Keep conditioned questions below their enclosing answer. The owning
          // Event still lists every Cut, including when its enclosing Cut belongs
          // to another Event or its reference is unresolved.
          const direct = cuts.filter((cut) => !cut.conditioning), conditional = cuts.filter((cut) => cut.conditioning);
          if (direct.length) body.append(listSection('Normalized Cuts', direct.map((cut) => cutNode(cut))));
          if (conditional.length) body.append(listSection('Conditional Cuts owned by this Event', conditional.map((cut) => lazy(
            `${labelOf(cut)} · conditional on ${cut.conditioning.cut_id} → ${cut.conditioning.answer_key}`,
            (part) => part.append(cutNode(cut)),
          ))));
        }
        for (const cut of index.physicalCutsByEvent.get(id) ?? []) {
          body.append(lazy(`Physical Cut · ${cut.id} · ${cut.kind ?? 'kind not declared'}`, (part) => {
            part.append(text('p', `Lens: ${cut.lens ?? 'not declared'}`, 'inspection-meta'));
            for (const child of cut.child_event_ids ?? []) part.append(definition(`Child Event · ${child}`, index.events.get(child) ?? { unresolved_event_id: child }));
            part.append(definition('Raw physical Cut definition', cut));
          }));
        }
        for (const [heading, ids] of [['Modeled processes', record.process_ids], ['Observation processes', record.observation_process_ids]]) {
          if (ids?.length) body.append(listSection(`${heading} · ${ids.length}`, ids.map((processId) => definition(processId, index.processes.get(processId) ?? { unresolved_process_id: processId }))));
        }
      } else {
        body.append(text('p', `Unit: ${record.unit ?? 'not declared'} · Value type: ${record.value_type?.kind ?? 'not declared'}`, 'inspection-meta'));
        if (record.scale?.semantic_role) body.append(text('p', `Role: ${record.scale.semantic_role}`, 'inspection-meta'));
        if (record.initial_value != null) body.append(definition('Declared initial value (not a trajectory)', record.initial_value));
      }
      if (children.length) {
        const nextPath = new Set(path).add(id);
        body.append(listSection(isEvent ? 'Contained Events' : 'Process decomposition', children.map((edge) => {
          const wrapper = document.createElement('div');
          wrapper.append(text('p', `${words(edge.kind)} · ${edge.id}`, 'inspection-edge'));
          wrapper.append(node(kind, isEvent ? edge.target_event_id : edge.child, nextPath, contexts)); return wrapper;
        })));
      }
      body.append(definition(`Raw ${kind} definition`, record)); container.append(body);
    });
    registry.set(key(kind, id), details); return details;
  }
  const section = document.createElement('section'); section.id = 'model-structure';
  section.append(text('h2', 'Model structure'), text('p', 'Expand a row to follow declared relationships. Event containment and process decomposition are separate. Shared nodes and cycles appear as references; Cut weights remain local to their own question.'));
  const eventTree = lazy(`Events · ${index.events.size} records`, (container) => {
    if (!index.eventChildren.size) container.append(text('p', 'No Event containment is declared. These are separate Event records.', 'inspection-meta'));
    for (const id of index.eventRoots) container.append(node('event', id));
  }, 'inspection-section');
  section.append(eventTree); eventTree.open = true;
  section.append(lazy(`Process decomposition · ${index.processes.size} processes · ${(model.decomposition ?? []).length} edges`, (container) => {
    container.append(text('p', (model.decomposition ?? []).length ? 'These children come only from declared process decomposition edges.' : 'No process decomposition edges are declared. These processes are not inferred to be children of one another.', 'inspection-meta'));
    for (const id of index.processRoots) container.append(node('process', id));
  }, 'inspection-section'));
  const orphanCuts = [...index.cuts.values()].filter((cut) => !index.events.has(cut.parent_event_id));
  if (orphanCuts.length) section.append(lazy(`Cuts with unresolved owning Events · ${orphanCuts.length}`, (container) => container.append(...orphanCuts.map((cut) => cutNode(cut))), 'inspection-section'));
  return section;
}

export function showInspector(data, notice = null, { host = null, onSelect = () => {} } = {}) {
  if (!document.querySelector('link[data-inspector]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'inspector.css'; css.dataset.inspector = '';
    document.head.append(css);
  }
  if (!host) document.body.className = 'inspector';
  const main = document.createElement('main'); main.className = 'inspection-content'; (host ?? document.body).replaceChildren(main);
  const model = data?.inspection?.model ?? {}, title = data?.title ?? model.id ?? 'Meaning Model'; document.title = title;
  main.append(text('p', 'Meaning Model · read-only snapshot', 'inspection-eyebrow'), text('h1', title));
  if (notice) main.append(text('p', notice, 'inspection-notice'));
  if (!data) return { activate() {}, deactivate() {} };
  const timeUnit = (model.time_unit ?? data.timeUnit) || 'not declared';
  main.append(text('p', timeUnit === 'civil_day_since_1970_01_01' ? 'Time: calendar days' : `Time: ${timeUnit}`, 'inspection-meta'));
  main.append(lazy('Snapshot details', (container) => {
    container.append(text('p', `Time unit: ${timeUnit}. Native interval bounds are retained.`, 'inspection-meta'));
    if (data.modelHash) container.append(text('p', `Model: ${data.modelHash}`, 'inspection-meta'));
    if (data.headGraphHash) container.append(text('p', `Graph: ${data.headGraphHash}`, 'inspection-meta'));
  }));
  const navigation = document.createElement('nav'); navigation.className = 'inspection-nav'; navigation.setAttribute('aria-label', 'Snapshot views');
  const story = (data.story?.units ?? []).filter((unit) => unit.text?.trim());
  for (const [label, href] of [['← Back to model', '#model-structure'], ...(story.length ? [['Read full story', '#rendered-document']] : []), ['Raw records', '#raw-records']]) {
    const link = text('a', label); link.href = href; navigation.append(link);
  }
  const selectedRecord = document.createElement('section'); selectedRecord.hidden = true; selectedRecord.className = 'inspection-selection';
  main.append(navigation, selectedRecord, structureView(model, onSelect));
  if (story.length) {
    const section = document.createElement('section'); section.id = 'rendered-document'; section.append(text('h2', 'Complete rendered document'), text('p', 'All current rendered passages, in native reading order. Expanding model records does not change this text.', 'inspection-meta'));
    for (const unit of story) section.append(proseUnit(unit.text));
    section.append(lazy('Literal rendered source', (container) => container.append(text('pre', story.map((unit) => unit.text).join('\n\n')))));
    main.append(section);
  }
  const groups = [];
  for (const [key, entries] of Object.entries(model)) if (Array.isArray(entries) && entries.length) groups.push({ label: words(key), records: entries });
  for (const [key, entries] of Object.entries(model.meaning_model ?? {})) if (Array.isArray(entries) && entries.length) groups.push({ label: words(key), records: entries });
  const graph = data.inspection?.graph ?? data.graph ?? {};
  if (graph.nodes?.length) groups.push({ label: 'Understanding graph records', records: graph.nodes });
  if (graph.edges?.length) groups.push({ label: 'Understanding graph links', records: graph.edges });
  const raw = document.createElement('section'); raw.id = 'raw-records'; raw.append(text('h2', 'Raw records'));
  for (const group of groups) raw.append(lazy(`${group.label} · ${group.records.length}`, (container) => {
    for (const [position, record] of group.records.entries()) {
      const id = record?.id ?? record?.event_id ?? `Record ${position + 1}`, description = labelOf(record);
      container.append(definition(description !== id ? `${id} — ${description}` : String(id), record));
    }
  }, 'inspection-section'));
  raw.append(definition('Complete model definition', model)); main.append(raw);
  let selectionGraph = null, lastSelection = null;
  return {
    activate(_view, state = {}) {
      const selection = state.selection, key = selection ? JSON.stringify(selection) : null;
      if (key === lastSelection) return; lastSelection = key;
      selectedRecord.hidden = !selection; selectedRecord.replaceChildren();
      if (!selection) return;
      selectionGraph ??= buildModelGraph(data.inspection ?? { model, graph: data.graph });
      const node = selectionGraph.nodes.find((node) => node.kind === selection.kind && node.nativeId === selection.id);
      selectedRecord.append(text('h2', `Selected ${words(selection.kind)}`), text('p', node?.label ?? selection.id), text('p', selection.id, 'inspection-meta'));
      if (node) selectedRecord.append(definition('Selected native record', node.record));
      else selectedRecord.append(text('p', 'This selection has no record in this snapshot.', 'inspection-meta'));
    },
    deactivate() {},
  };
}
