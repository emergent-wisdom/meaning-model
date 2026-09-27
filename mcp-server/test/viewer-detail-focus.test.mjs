import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
function between(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Missing viewer section ${startText}`);
  return source.slice(start, end);
}
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `Missing viewer function ${name}`);
  return source.slice(start, end + 2);
}

test('detail and focus choose among the kinds Show includes, so Processes never becomes the tree', () => {
  const node = (id, kind = 'event', trunk = false) => ({ id, kind, trunk, depth: 2 });
  const projection = { eventIds: new Set(['world', 'life', 'part', 'sub']), retainedEventIds: new Set(['world', 'life']), rowIds: new Set(), level: 2, maxLevel: 3 };
  const context = { opt: { detailProjection: projection, show: new Set(['processes', 'threads']), hideUnopened: false, hideFlat: false, depth: 2 }, unopenedProcessIds: new Set(), CUT_ROW: 6, ROW: 2.7 };
  vm.createContext(context);
  vm.runInContext(between('const visibleNode =', 'function pack(') + '\nthis.visibleNode = visibleNode;', context);
  const [world, part, sub] = [node('world', 'event', true), node('part'), node('sub', 'sub')];
  // Processes, with the tree of Events and subsidiary processes hidden: no outline appears at any detail.
  for (const item of [world, part, sub]) assert.equal(context.visibleNode(item, false), false, item.id);
  // Tree keeps its trunk, and shows the rest once its kinds are shown.
  assert.equal(context.visibleNode(world, true), true);
  assert.equal(context.visibleNode(part, true), false);
  context.opt.show.add('events'); context.opt.show.add('subsidiary');
  for (const item of [world, part, sub]) assert.equal(context.visibleNode(item, false), true, item.id);
  // Detail still decides which of them: an Event outside the projection stays hidden.
  assert.equal(context.visibleNode(node('elsewhere'), false), false);
});

test('Focus lists each whole under whose it is, people first, parts indented in time order', () => {
  const event = (id, parent, owner, start) => ({ id, parent, owner, start, label: id });
  const events = [event('world', null, null, null), event('ana.life', 'world', 'ana', 1980), event('ana.youth', 'ana.life', 'ana', 1990),
    event('ana.youth.school', 'ana.youth', 'ana', 1991), event('ana.work', 'ana.life', 'ana', 1985), event('bo.life', 'world', 'bo', 1970),
    event('shop.life', 'world', 'shop', 1950), event('market', 'world', null, 2000)];
  const treeById = new Map(events.map((item) => [item.id, item]));
  const context = {
    processDetail: { options: events.filter((item) => item.id !== 'world').map((item) => ({ id: item.id, label: item.label, depth: 0 })) },
    treeById, principals: [{ id: 'bo', name: 'Bo Lind' }, { id: 'ana', name: 'Ana Berg' }],
    data: { people: [{ id: 'ana', name: 'Ana Berg' }, { id: 'bo', name: 'Bo Lind' }] }, referents: new Map([['shop', { id: 'shop', name: 'The shop' }]]),
    push: (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); },
  };
  vm.createContext(context);
  vm.runInContext(functionSource('focusGroups') + '\nthis.focusGroups = focusGroups;', context);
  // The groups come from the viewer's own realm; compare them as plain data.
  const groups = JSON.parse(JSON.stringify(context.focusGroups().map((group) => [group.name, group.entries.map(({ item, depth }) => `${depth}:${item.id}`)])));
  assert.deepEqual(groups, [
    ['Bo Lind', ['0:bo.life']],
    ['Ana Berg', ['0:ana.life', '1:ana.work', '1:ana.youth', '2:ana.youth.school']],
    ['The shop', ['0:shop.life']],
    ['The world', ['0:market']],
  ]);
});
