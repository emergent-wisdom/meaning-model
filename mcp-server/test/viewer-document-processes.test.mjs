import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDocumentProcesses } from '../viewer/public/document-processes.js';

function fixture() {
  const document = { createElement(tag) {
    return {
      tag, ownerDocument: document, children: [], className: '', textContent: '',
      value: '', style: {}, open: false, attributes: {}, listeners: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      fire(name) { this.listeners[name]?.({ target: this }); },
      set innerHTML(value) { assert.fail(`Authored process data must stay literal text: ${value}`); },
    };
  } };
  const root = document.createElement('div');
  const all = (node = root) => [node, ...node.children.flatMap(child => all(child))];
  const byClass = name => all().find(node => node.className === name);
  const button = label => all().find(node => node.tag === 'button' && node.textContent === label);
  return { root, all, byClass, button, text: () => all().map(node => node.textContent).join('\n') };
}

const phase = (overrides = {}) => ({
  label: 'A possibility appears', description: 'An unanswered question has become actionable.',
  status: 'current', start: 10, end: 30, startNodeId: 'passage.first',
  spanTitle: 'First passage', evidence: [{ nodeId: 'passage.first', excerpt: 'The door was still open.' }],
  ...overrides,
});
const process = (overrides = {}) => ({
  nodeId: 'telling.pressure', label: 'Opportunities to speak', question: 'Will they tell each other?',
  summary: 'A selected reading of the changing opportunities, not a measurement.',
  states: [phase()], ...overrides,
});
const projection = (processes = [process()], extra = {}) => ({ byteLength: 100, processes, ...extra });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('document processes are absent without authored records and otherwise start collapsed', () => {
  const f = fixture();
  assert.equal(appendDocumentProcesses(f.root, undefined), false);
  assert.equal(appendDocumentProcesses(f.root, projection([])), false);
  assert.equal(f.root.children.length, 0);
  assert.equal(appendDocumentProcesses(f.root, projection()), true);
  assert.equal(f.root.children[0].tag, 'details');
  assert.equal(f.root.children[0].open, false);
  assert.match(f.text(), /authored interpretations/);
  assert.match(f.text(), /Position in the text; world time stays unchanged/);
  assert.equal(f.all().find(node => node.tag === 'select').attributes['aria-label'], 'Story process');
  assert.equal(f.byClass('document-process-detail').attributes['aria-live'], 'polite');
  assert.deepEqual(f.byClass('document-process-extent').style, { left: '10%', width: '20%' });
});

test('process and phase selection follows reading order without changing supplied records', () => {
  const later = phase({ label: 'A later complication', start: 60, end: 90, startNodeId: 'passage.later',
    description: 'The old answer no longer works.', evidence: [{ excerpt: 'Nobody answered.' }] });
  const data = freeze(projection([
    process({ states: [later, phase()] }),
    process({ nodeId: 'telling.pace', label: 'Changing pace', question: 'Where does the telling pause?',
      summary: 'A short interruption.', states: [phase({ label: 'A pause', start: 40, end: 50, evidence: [] })] }),
  ]));
  const f = fixture(); const calls = [];
  appendDocumentProcesses(f.root, data, { onSelect: id => calls.push(id), onRead: id => calls.push(id) });
  const phases = f.byClass('document-process-phases');
  assert.deepEqual(phases.children.map(node => node.textContent), ['A possibility appears', 'A later complication']);
  assert.deepEqual(phases.children.map(node => node.attributes['aria-pressed']), ['true', 'false']);
  f.button('A later complication').fire('click');
  assert.deepEqual(phases.children.map(node => node.attributes['aria-pressed']), ['false', 'true']);
  assert.match(f.text(), /The old answer no longer works/);
  assert.deepEqual(f.all().filter(node => node.tag === 'blockquote').map(node => node.textContent), ['Nobody answered.']);
  assert.deepEqual(f.byClass('document-process-extent').style, { left: '60%', width: '30%' });
  const chooser = f.all().find(node => node.tag === 'select');
  chooser.value = '1'; chooser.fire('change');
  assert.equal(f.byClass('document-process-question').textContent, 'Where does the telling pause?');
  assert.deepEqual(phases.children.map(node => node.textContent), ['A pause']);
  assert.equal(f.all().filter(node => node.tag === 'blockquote').length, 0, 'previous process evidence is cleared');
  assert.equal(f.byClass('document-process-summary').textContent, 'A short interruption.');
  assert.equal(data.processes[0].states[0], later, 'sorting leaves authored input order untouched');
  assert.deepEqual(calls, [], 'browsing interpretations does not invoke navigation or change world time');
});

test('locate, read and inspect delegate only the selected identities to their callbacks', () => {
  const f = fixture(); const calls = [];
  const data = freeze(projection([
    process(),
    process({ nodeId: 'telling.recognition', states: [phase({ startNodeId: 'passage.recognition' })] }),
  ], { worldTime: 2022.4 }));
  appendDocumentProcesses(f.root, data, {
    onSelect: id => calls.push(['select', id]), onRead: id => calls.push(['read', id]),
  });
  assert.deepEqual(calls, []);
  f.button('Locate passage').fire('click'); f.button('Read passage').fire('click');
  f.button('Inspect process').fire('click');
  const chooser = f.all().find(node => node.tag === 'select');
  chooser.value = '1'; chooser.fire('change');
  f.button('Locate passage').fire('click'); f.button('Read passage').fire('click');
  f.button('Inspect process').fire('click');
  assert.deepEqual(calls, [
    ['select', 'passage.first'], ['read', 'passage.first'], ['select', 'telling.pressure'],
    ['select', 'passage.recognition'], ['read', 'passage.recognition'], ['select', 'telling.recognition'],
  ]);
  assert.equal(data.worldTime, 2022.4);
});

test('unresolved phases retain interpretation and evidence but offer no passage navigation', () => {
  const f = fixture(); const calls = [];
  appendDocumentProcesses(f.root, projection([process({ states: [phase({
    status: 'unresolved', start: null, end: null, startNodeId: null,
  })] })]), { onSelect: id => calls.push(id), onRead: () => assert.fail('Unresolved passage cannot be read') });
  assert.match(f.text(), /Passage attachment unresolved/);
  assert.match(f.text(), /The door was still open/);
  assert.equal(f.button('Locate passage'), undefined);
  assert.equal(f.button('Read passage'), undefined);
  assert.equal(f.byClass('document-process-axis'), undefined);
  f.button('Inspect process').fire('click');
  assert.deepEqual(calls, ['telling.pressure']);
});

test('changed text is visibly marked for review without inventing a new interpretation', () => {
  const f = fixture();
  appendDocumentProcesses(f.root, projection([process({ states: [phase({ status: 'needs_review' })] })]));
  assert.match(f.text(), /Needs review: the text or its order has changed/);
  assert.match(f.text(), /An unanswered question has become actionable/);
  assert.ok(f.button('Locate passage'));
  assert.ok(f.button('Read passage'));
});

test('invalid or absent byte extents receive no invented position or numerical score', () => {
  for (const range of [
    { start: -1, end: 20 }, { start: 90, end: 101 }, { start: 40, end: 10 },
    { start: 1.5, end: 20 }, { start: undefined, end: undefined },
  ]) {
    const f = fixture(); appendDocumentProcesses(f.root, projection([process({ states: [phase(range)] })]));
    assert.equal(f.byClass('document-process-axis'), undefined);
    assert.equal(f.byClass('document-process-map').hidden, true);
    assert.equal(f.byClass('document-process-map').children.length, 0);
    assert.equal(f.all().filter(node => node.tag === 'blockquote').length, 1);
  }
  const empty = fixture();
  appendDocumentProcesses(empty.root, projection([process({ states: [phase({ start: 0, end: 0 })] })], { byteLength: 0 }));
  assert.equal(empty.byClass('document-process-axis'), undefined);
  assert.equal(empty.byClass('document-process-map').hidden, true);
});

test('authored labels, questions, prose evidence and descriptions cannot become HTML', () => {
  const markup = '<img src=x onerror="globalThis.compromised=true">';
  const f = fixture();
  appendDocumentProcesses(f.root, projection([process({ label: markup, question: markup, summary: markup,
    states: [phase({ label: markup, description: markup, spanTitle: markup, evidence: [{ excerpt: markup }] })],
  })]));
  assert.equal(f.all().find(node => node.tag === 'option').textContent, markup);
  assert.equal(f.byClass('document-process-question').textContent, markup);
  assert.equal(f.byClass('document-process-summary').textContent, markup);
  assert.equal(f.byClass('document-process-phases').children[0].textContent, markup);
  assert.equal(f.all().find(node => node.tag === 'blockquote').textContent, markup);
  assert.ok(f.all().some(node => node.tag === 'p' && node.textContent === markup));
  assert.equal(f.all().some(node => ['img', 'script', 'iframe'].includes(node.tag)), false);
  assert.match(f.text(), /authored interpretations/);
});

test('the overview places every phase at its actual passage extent and separates overlaps without changing the data', () => {
  const first = phase({ label: 'Opening question', start: 10, end: 40 });
  const overlapping = phase({ label: 'An overlapping possibility', start: 30, end: 50, status: 'needs_review' });
  const later = phase({ label: 'Return to the question', start: 60, end: 80 });
  const data = freeze(projection([process({ states: [later, overlapping, first] })]));
  const f = fixture(); appendDocumentProcesses(f.root, data);
  const map = f.byClass('document-process-map');
  assert.equal(map.attributes.role, 'group');
  assert.equal(map.attributes['aria-label'], 'Phases across reading position');
  assert.deepEqual(map.children.map((mark) => mark.style), [
    { left: '10%', width: '30%', top: '0px' },
    { left: '30%', width: '20%', top: '28px' },
    { left: '60%', width: '20%', top: '0px' },
  ]);
  assert.equal(map.style.height, '56px');
  assert.deepEqual(map.children.map((mark) => mark.textContent), ['1', '2', '3']);
  assert.deepEqual(map.children.map((mark) => mark.attributes['aria-pressed']), ['true', 'false', 'false']);
  assert.match(map.children[1].attributes['aria-label'], /Phase 2: An overlapping possibility.*Needs review/u);
  assert.equal(map.children[1].attributes['data-status'], 'needs_review');
  assert.ok(map.children.every((mark) => mark.tag === 'button' && mark.type === 'button'),
    'native buttons retain keyboard activation and focus');
  assert.match(f.text(), /Position and width follow the text/u);
  assert.match(f.text(), /Overlapping phases use separate rows/u);
  assert.equal(data.processes[0].states[0], later);
});

test('selecting a graphical phase synchronizes labels and evidence while Locate, Read and Inspect keep their identities', () => {
  const later = phase({ label: 'A later answer', start: 65, end: 85, startNodeId: 'passage.answer',
    evidence: [{ nodeId: 'passage.answer', excerpt: 'At last, an answer.' }] });
  const data = freeze(projection([process({ states: [phase(), later] })], { worldTime: 1852.5 }));
  const f = fixture(); const calls = [];
  appendDocumentProcesses(f.root, data, { onSelect: (id) => calls.push(['select', id]), onRead: (id) => calls.push(['read', id]) });
  const map = f.byClass('document-process-map');
  map.children[1].fire('click');
  assert.deepEqual(calls, [], 'selecting a phase only explores its account');
  assert.deepEqual(map.children.map((mark) => mark.attributes['aria-pressed']), ['false', 'true']);
  assert.deepEqual(f.byClass('document-process-phases').children.map((button) => button.attributes['aria-pressed']), ['false', 'true']);
  assert.match(f.text(), /At last, an answer/u);
  f.button('Locate passage').fire('click'); f.button('Read passage').fire('click'); f.button('Inspect process').fire('click');
  assert.deepEqual(calls, [['select', 'passage.answer'], ['read', 'passage.answer'], ['select', 'telling.pressure']]);
  f.button('A possibility appears').fire('click');
  assert.deepEqual(map.children.map((mark) => mark.attributes['aria-pressed']), ['true', 'false']);
  assert.equal(data.worldTime, 1852.5);
});

test('unresolved phases are listed without invented placement, and switching processes clears the previous overview', () => {
  const unresolved = phase({ label: 'Attachment needing repair', status: 'unresolved', start: 20, end: 45 });
  const f = fixture();
  appendDocumentProcesses(f.root, projection([
    process({ states: [unresolved, phase()] }),
    process({ nodeId: 'another.process', states: [phase({ label: 'A later interval', start: 75, end: 100 })] }),
  ]));
  const map = f.byClass('document-process-map');
  assert.equal(map.children.length, 1, 'an unresolved attachment is excluded even if stale offsets are present');
  assert.match(f.text(), /1 phase has no current position/u);
  f.button('Attachment needing repair').fire('click');
  assert.equal(map.children[0].attributes['aria-pressed'], 'false');
  assert.equal(f.button('Read passage'), undefined);
  assert.equal(f.byClass('document-process-axis'), undefined);
  const chooser = f.all().find((node) => node.tag === 'select');
  chooser.value = '1'; chooser.fire('change');
  assert.equal(map.children.length, 1);
  assert.deepEqual(map.children[0].style, { left: '75%', width: '25%', top: '0px' });
  assert.equal(map.children[0].attributes['aria-label'], 'Phase 1: A later interval');
  assert.ok(!f.text().includes('no current position'));
});
