// The native document projection supplies the boundaries. No calendar or tension
// values are inferred from prose, titles, or the modeler's authoring clock.
export function appendDocumentProcesses(container, projection, { onSelect = () => {}, onRead = () => {} } = {}) {
  const processes = projection?.processes;
  if (!processes?.length) return false;
  const document = container.ownerDocument;
  const el = (tag, className = '', text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // The book's own processes, in reading order rather than world time: open, with every process shown together.
  const section = el('details', 'document-processes'); section.open = true;
  section.append(el('summary', '', `Story processes (${processes.length})`));
  const body = el('div', 'document-processes-body');
  body.append(el('p', 'document-process-help', 'How the telling develops across the text. These are authored interpretations; select a phase to see its evidence.'));
  // Every process at once, each a row of phases across the text, so the book's own development reads as one picture.
  const everyProcess = el('div', 'document-process-all'); everyProcess.setAttribute('role', 'group'); everyProcess.setAttribute('aria-label', 'All story processes across the text');
  body.append(everyProcess);
  const chooser = el('select'); chooser.setAttribute('aria-label', 'Story process');
  processes.forEach((process, i) => { const option = el('option', '', process.label); option.value = String(i); chooser.append(option); });
  body.append(chooser);
  const question = el('p', 'document-process-question');
  const summary = el('p', 'document-process-summary');
  const overview = el('div', 'document-process-overview');
  const axisLabels = el('div', 'document-process-map-labels');
  axisLabels.append(el('span', '', 'Start of text'), el('span', '', 'End of text'));
  const map = el('div', 'document-process-map');
  map.setAttribute('role', 'group'); map.setAttribute('aria-label', 'Phases across reading position');
  const mapHelp = el('p', 'document-process-help');
  overview.append(axisLabels, map, mapHelp);
  const phases = el('div', 'document-process-phases'); phases.setAttribute('aria-label', 'Phases in reading order');
  const detail = el('div', 'document-process-detail'); detail.setAttribute('aria-live', 'polite');
  body.append(question, summary, overview, phases, detail);
  const buttons = []; const mapButtons = [];
  const hasPosition = (state) => state.status !== 'unresolved'
    && Number.isSafeInteger(projection.byteLength) && projection.byteLength > 0
    && Number.isSafeInteger(state.start) && Number.isSafeInteger(state.end)
    && state.start >= 0 && state.end >= state.start && state.end <= projection.byteLength;
  function showState(state, index) {
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(index === i)));
    mapButtons.forEach((entry) => entry.button.setAttribute('aria-pressed', String(index === entry.index)));
    detail.replaceChildren();
    detail.append(el('strong', '', state.label));
    if (state.status !== 'current') detail.append(el('p', 'document-process-status',
      state.status === 'unresolved' ? 'Passage attachment unresolved. Reattach this phase before relying on its position.'
        : 'Needs review: the text or its order has changed since this assessment.'));
    detail.append(el('p', '', state.description));
    if (hasPosition(state)) {
      const axis = el('div', 'document-process-axis'); axis.setAttribute('aria-label', 'This phase within the complete text');
      const extent = el('div', 'document-process-extent');
      extent.style.left = `${state.start / projection.byteLength * 100}%`;
      extent.style.width = `${(state.end - state.start) / projection.byteLength * 100}%`;
      axis.append(extent); detail.append(axis);
      const spanLabel = state.spanTitle && state.spanTitle !== state.spanId ? state.spanTitle : 'Passage span';
      detail.append(el('p', 'document-process-help', `${spanLabel} · Position in the text; world time stays unchanged.`));
    }
    for (const evidence of state.evidence ?? []) detail.append(el('blockquote', '', evidence.excerpt));
    const actions = el('div', 'document-process-actions');
    if (state.status !== 'unresolved') {
      const locate = el('button', '', 'Locate passage'); locate.type = 'button';
      locate.addEventListener('click', () => onSelect(state.startNodeId));
      const read = el('button', '', 'Read passage'); read.type = 'button';
      read.addEventListener('click', () => onRead(state.startNodeId));
      actions.append(locate, read);
    }
    const inspect = el('button', '', 'Inspect process'); inspect.type = 'button';
    inspect.addEventListener('click', () => onSelect(processes[Number(chooser.value || 0)].nodeId));
    actions.append(inspect); detail.append(actions);
  }
  function showProcess() {
    const process = processes[Number(chooser.value || 0)];
    question.textContent = process.question; summary.textContent = process.summary;
    phases.replaceChildren(); buttons.length = 0;
    map.replaceChildren(); mapButtons.length = 0;
    const states = [...process.states].sort((a, b) => (hasPosition(a) ? a.start : Infinity) - (hasPosition(b) ? b.start : Infinity));
    const lanes = [];
    states.forEach((state, index) => {
      const button = el('button', '', state.label); button.type = 'button';
      button.setAttribute('data-phase', String(index + 1));
      button.setAttribute('aria-label', `Phase ${index + 1}: ${state.label}`);
      button.addEventListener('click', () => showState(state, index));
      buttons.push(button); phases.append(button);
      if (!hasPosition(state)) return;
      // Separate overlapping extents so every authored phase remains visible.
      // Rows carry no magnitude; only horizontal position represents the text.
      let lane = lanes.findIndex((previous) => state.start >= previous.end
        && !(state.start === previous.start && previous.start === previous.end));
      if (lane < 0) { lane = lanes.length; lanes.push(state); } else lanes[lane] = state;
      const mark = el('button', `document-process-map-phase${state.start === state.end ? ' point' : ''}`, String(index + 1));
      mark.type = 'button';
      const label = `Phase ${index + 1}: ${state.label}${state.status === 'current' ? '' : ' · Needs review'}`;
      mark.setAttribute('aria-label', label); mark.title = label;
      mark.setAttribute('data-status', state.status);
      mark.style.left = `${state.start / projection.byteLength * 100}%`;
      mark.style.width = `${(state.end - state.start) / projection.byteLength * 100}%`;
      mark.style.top = `${lane * 28}px`;
      mark.addEventListener('click', () => showState(state, index));
      mapButtons.push({ button: mark, index }); map.append(mark);
    });
    map.style.height = `${lanes.length * 28}px`;
    map.hidden = axisLabels.hidden = !mapButtons.length;
    const unplaced = states.length - mapButtons.length;
    mapHelp.textContent = mapButtons.length
      ? `Position and width follow the text. Overlapping phases use separate rows.${unplaced ? ` ${unplaced} ${unplaced === 1 ? 'phase has' : 'phases have'} no current position; select ${unplaced === 1 ? 'it' : 'them'} below.` : ''}`
      : 'No current passage positions are available. Select a phase below to inspect its attachment.';
    if (states.length) showState(states[0], 0);
  }
  chooser.addEventListener('change', showProcess); showProcess();
  const placed = (state) => hasPosition(state);
  processes.forEach((process, processIndex) => {
    const row = el('div', 'document-process-row');
    const name = el('button', 'document-process-row-label', process.label); name.type = 'button'; name.title = process.question ?? process.label;
    name.addEventListener('click', () => { chooser.value = String(processIndex); showProcess(); });
    const track = el('div', 'document-process-track');
    const states = [...process.states].sort((a, b) => (placed(a) ? a.start : Infinity) - (placed(b) ? b.start : Infinity));
    states.forEach((state, index) => {
      if (!placed(state)) return;
      const mark = el('button', `document-process-track-phase${index % 2 ? ' alternate' : ''}${state.start === state.end ? ' point' : ''}`); mark.type = 'button';
      const label = `${process.label} · ${state.label}${state.status === 'current' ? '' : ' · Needs review'}`;
      mark.title = label; mark.setAttribute('aria-label', label); mark.setAttribute('data-status', state.status);
      mark.style.left = `${state.start / projection.byteLength * 100}%`;
      mark.style.width = `${(state.end - state.start) / projection.byteLength * 100}%`;
      mark.addEventListener('click', () => { chooser.value = String(processIndex); showProcess(); showState(state, index); });
      track.append(mark);
    });
    row.append(name, track); everyProcess.append(row);
  });
  section.append(body); container.append(section); return true;
}
