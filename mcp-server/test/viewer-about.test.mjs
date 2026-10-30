import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { viewSettingsProblems } from '../viewer/public/view-settings.js';

// The referent filter, as view.js holds it, over a small world: a continent cut into a north (with a city) and a south,
// an island outside it, and a person.
const source = readFileSync(new URL('../viewer/public/view.js', import.meta.url), 'utf8');
const slice = (start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from >= 0 && to > from, start); return source.slice(from, to + end.length); };
const filterSource = `${slice('const declaredMeaning =', 'about.events.has(row.measure.home));')}\n${slice('function hiddenEventIds(', '\n}')}`;
function about(data, id) {
  const context = { data, opt: {}, unimportantEventIds: () => null, push: (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); } };
  vm.createContext(context);
  vm.runInContext(`${filterSource}\nopt.about = referentIds.has(${JSON.stringify(id)}) ? aboutSets(${JSON.stringify(id)}) : null;
    this.about = opt.about; this.hidden = hiddenEventIds(); this.aboutRow = aboutRow;`, context);
  return context;
}
const sorted = (set) => [...set].sort();

const data = {
  referents: [{ id: 'continent', name: 'The continent: all of it' }, { id: 'north', name: 'North' }, { id: 'south', name: 'South' },
    { id: 'city', name: 'The city' }, { id: 'island', name: 'Island' }, { id: 'ana', name: 'Ana', person: true }],
  events: [
    { id: 'world', parent: null, participants: [] },
    { id: 'age', parent: 'world', participants: [] },
    { id: 'north.war', parent: 'age', participants: [], region: 'Somewhere in the north' },
    { id: 'city.founded', parent: 'age', owner: 'city', participants: [] },
    { id: 'island.storm', parent: 'age', participants: [] },
    { id: 'ana.journey', parent: 'age', participants: ['ana'], region: 'south' },
    { id: 'north.war.reading', parent: 'north.war', role: 'reading', reading: true, participants: [] },
  ],
  processes: [{ id: 'p.north', owner: 'north' }, { id: 'p.island', owner: 'island' }, { id: 'p.continent', owner: 'continent' }],
  inspection: { model: { meaning_model: {
    referents: [{ id: 'continent', boundary: 'The continent' }],
    encapsulation_cuts: [
      { parent_referent_id: 'continent', children: [{ referent_id: 'north' }, { referent_id: 'south' }] },
      { parent_referent_id: 'north', children: [{ referent_id: 'city' }] }],
    event_referent_bindings: [
      { binding_type: 'located_in', referent_id: 'north', target: { kind: 'event', event_id: 'north.war' } },
      { binding_type: 'located_in', referent_id: 'island', target: { kind: 'event', event_id: 'island.storm' } },
      { binding_type: 'coordinate', referent_id: 'south', target: { kind: 'process', process_id: 'p.south.place' } }] } } },
};

test('a referent shows what is bound to it or to its parts, with the Events that contain those', () => {
  const { about: continent, hidden } = about(data, 'continent');
  assert.equal(continent.name, 'The continent');
  assert.deepEqual(sorted(continent.within), ['city', 'continent', 'north', 'south'], 'its parts through the encapsulation Cuts, all the way down');
  // A binding, an owner and an Event's region or participants that name a referent each say an Event is about it.
  assert.deepEqual(sorted(continent.bound), ['ana.journey', 'city.founded', 'north.war']);
  assert.deepEqual(sorted(continent.events), ['age', 'ana.journey', 'city.founded', 'north.war', 'world']);
  assert.deepEqual(sorted(continent.processes), ['p.continent', 'p.north', 'p.south.place']);
  assert.deepEqual(sorted(hidden), ['island.storm'], 'a reading stays with its row');
});

test('a part shows only its own, and a person the Events they take part in', () => {
  assert.deepEqual(sorted(about(data, 'north').about.bound), ['city.founded', 'north.war']);
  const ana = about(data, 'ana');
  assert.deepEqual(sorted(ana.about.bound), ['ana.journey']);
  assert.deepEqual(sorted(ana.hidden), ['city.founded', 'island.storm', 'north.war']);
  assert.equal(ana.about.processes.size, 0);
  // A region written as words names no referent.
  assert.equal(about(data, 'Somewhere in the north').about, null);
  assert.equal(about(data, 'nobody').hidden, null, 'an unknown referent filters nothing');
});

test('a row is about the referent through its process, its owner or the Event its Cut answers', () => {
  const { about: continent, aboutRow } = about(data, 'continent');
  const row = (measure) => ({ measure });
  assert.equal(aboutRow(row({ id: 'p.north' }), continent), true);
  assert.equal(aboutRow(row({ id: 'series', processId: 'p.continent' }), continent), true);
  assert.equal(aboutRow(row({ id: 'p.island' }), continent), false);
  assert.equal(aboutRow(row({ id: 'cut.share', kind: 'cut-answer', owner: 'city', home: 'island.storm' }), continent), true);
  assert.equal(aboutRow(row({ id: 'cut.storm', kind: 'cut-answer', owner: 'island', home: 'north.war' }), continent), true);
  assert.equal(aboutRow(row({ id: 'cut.storm', kind: 'cut-answer', owner: 'island', home: 'island.storm' }), continent), false);
});

test('the filter is an address setting a chosen view can set too', () => {
  assert.deepEqual(viewSettingsProblems({ about: 'continent' }), []);
  assert.match(viewSettingsProblems({ about: ' ' })[0], /^about=.* must be not empty/);
});
