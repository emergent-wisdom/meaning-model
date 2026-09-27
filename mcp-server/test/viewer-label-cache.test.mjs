import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const start = source.indexOf('const labels2 = (() => {');
const end = source.indexOf('\n})();', start);
assert.ok(start >= 0 && end > start, 'the real label pool must be present');
const labelSource = source.slice(start, end + '\n})();'.length);

function element() {
  const el = { className: '', innerHTML: '', style: {}, offsetWidth: 100, offsetHeight: 20 };
  el.classList = {
    contains(name) { return el.className.split(/\s+/).includes(name); },
    add(name) { if (!this.contains(name)) el.className += ` ${name}`; },
    remove(name) { el.className = el.className.split(/\s+/).filter((item) => item !== name).join(' '); },
  };
  return el;
}

function fixture() {
  const layer = { children: [], append(el) { this.children.push(el); } };
  const node = { id: 'life', shown: true, kind: 'event', depth: 1, t0: 0, t1: 100,
    event: { name: 'A character’s life', start: 0 } };
  const context = { layer, nodes: [node], panels: [], terrain: { on: false }, floors: [], selectedLinks: [],
    LENGTH: 100, BAR: 0.3, blend: { now: 0 }, smooth: (value) => value,
    opt: { show: new Set() }, litChain: new Set(), innerWidth: 500, innerHeight: 400,
    shownNow: (item) => item.shown, shownByPlay: () => true, bornAt: () => -Infinity,
    nodeAt: () => ({ y: 0, z: 0 }), playbackClock: () => ({}),
    playbackSpan: (start, end) => ({ start, end }), X: (time) => time - 50,
    words: (text) => text, screen: () => ({ x: 180, y: 160, ok: true }),
    labels: { domElement: { querySelectorAll: () => [] } },
    document: { getElementById: () => layer, createElement: element, querySelectorAll: () => context.panels },
  };
  vm.createContext(context); vm.runInContext(`${labelSource}\nthis.updateLabels = labels2.update;`, context);
  return context;
}

test('an Event label returns to the same screen position after repeated coarse/detail hide and show cycles', () => {
  const context = fixture(); context.updateLabels();
  const label = context.layer.children[0], position = label.style.transform;
  assert.equal(position, 'translate(180px, 140px)');
  for (let cycle = 0; cycle < 4; cycle += 1) {
    context.nodes[0].shown = false; context.updateLabels(); context.updateLabels();
    assert.equal(label.classList.contains('hide'), true);
    context.nodes[0].shown = true; context.updateLabels();
    assert.equal(label.classList.contains('hide'), false);
    assert.equal(label.style.transform, position, `cycle ${cycle}: a retained label cannot stay at its offscreen measurement position`);
    assert.equal(context.layer.children.length, 1, 'the same Event label is reused');
  }
});

test('collision-hidden labels stay hidden across repeated frames and reappear when the panel moves away', () => {
  const context = fixture(); context.updateLabels();
  const label = context.layer.children[0], position = label.style.transform;
  context.panels = [{ getBoundingClientRect: () => ({ left: 150, right: 300, top: 100, bottom: 200, width: 150 }) }];
  for (let frame = 0; frame < 4; frame += 1) {
    context.updateLabels();
    assert.equal(label.classList.contains('hide'), true, `frame ${frame}: measurement must not clear the retained collision-hidden class`);
  }
  context.panels = []; context.updateLabels();
  assert.equal(label.classList.contains('hide'), false);
  assert.equal(label.style.transform, position);
});

test('remeasuring changed label text restores the final transform even when its measured size and position are unchanged', () => {
  const context = fixture(); context.updateLabels();
  const label = context.layer.children[0], position = label.style.transform;
  context.nodes[0].event.name = 'A revised life label'; context.updateLabels();
  assert.equal(label.innerHTML, 'A revised life label');
  assert.equal(label.style.transform, position);
  context.terrain.on = true; context.updateLabels();
  assert.equal(label.classList.contains('hide'), true);
  context.terrain.on = false; context.updateLabels();
  assert.equal(label.classList.contains('hide'), false);
  assert.equal(label.style.transform, position);
});

test('the focused whole keeps its label when an overview label competes for the same screen space', () => {
  const context = fixture();
  context.nodes.unshift({ id: 'world', shown: true, kind: 'event', depth: 0, t0: 0, t1: 100, event: { name: 'The world', start: 0 } });
  context.updateLabels();
  const world = context.layer.children.find((label) => label.innerHTML === 'The world');
  const life = context.layer.children.find((label) => label.innerHTML === 'A character’s life');
  assert.equal(world.classList.contains('hide'), false);
  assert.equal(life.classList.contains('hide'), true);
  context.opt.processScope = 'life'; context.updateLabels();
  assert.equal(life.classList.contains('hide'), false, 'the selected process identity takes precedence in a narrow viewport');
  assert.equal(world.classList.contains('hide'), true);
  assert.equal(life.style.transform, 'translate(180px, 140px)');
});
