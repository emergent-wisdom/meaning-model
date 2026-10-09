// The view a model chooses for its reader: written in the viewer's address settings, recorded as the modeler's decision
// about every record it names, superseding the previous view, and opened by the viewer unless the reader has chosen.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { viewerViewSchema } from '../src/viewer-view.mjs';
import { curationAt, everythingLevel, openingView, sameSettings, settingsAt, viewAddress, viewSettingsProblems } from '../viewer/public/view-settings.js';

test('a view\'s settings are the viewer\'s own address settings, checked as the viewer parses them', () => {
  assert.deepEqual(viewSettingsProblems({ show: 'processes,causal,notes', t0: '1800', t1: '1876', view: 'together', rows: 'all', everything: '' }), []);
  assert.match(viewSettingsProblems({ camera: 'locked' })[0], /camera is the reader's: a view chooses what to look at, not how the reader moves through it/u);
  assert.match(viewSettingsProblems({ colour: 'red' })[0], /colour is not a viewer setting/u);
  assert.match(viewSettingsProblems({ glare: 'dim' })[0], /glare=dim must be one of full, soft/u);
  assert.match(viewSettingsProblems({ show: 'processes,clouds' })[0], /a comma list of processes/u);
  assert.match(viewSettingsProblems({ smooth: '2' })[0], /from 0 to 1/u);
  assert.match(viewSettingsProblems({ detail: 1 })[0], /must be a string/u);
  assert.deepEqual(viewSettingsProblems({ t0: '1900' }), ['t0 and t1 go together.']);
  assert.deepEqual(viewSettingsProblems({ t0: '1900', t1: '1850' }), ['t0 must be before t1.']);
});

test('view targets reject model and path qualifiers at every level instead of selecting a different record', () => {
  const input = { graphHash: 'a'.repeat(64), requestId: 'qualified', accessScopes: ['author'], holder: 'modeler', title: 'View', caption: 'What matters.' };
  for (const field of ['rows', 'highlights']) for (const nested of [false, true]) {
    const target = { record: 'cut:attention', ...(field === 'highlights' ? { why: 'Its change matters.' } : {}) };
    const withTarget = (item) => ({ ...input, ...(nested ? { levels: [{ label: '+ detail', [field]: [item] }] } : { [field]: [item] }) });
    assert.ok(viewerViewSchema.safeParse(withTarget(target)).success);
    for (const qualifier of [{ modelHash: 'a'.repeat(64) }, { modelHash: 'b'.repeat(64) }, { path: '/answers/0' }]) {
      const parsed = viewerViewSchema.safeParse(withTarget({ ...target, ...qualifier }));
      assert.equal(parsed.success, false, `${nested ? 'level ' : ''}${field} must reject ${JSON.stringify(qualifier)}`);
      assert.match(JSON.stringify(parsed.error.issues), /unrecognized_keys/u);
    }
  }
});

test('a view refuses undisplayed containment and about links before recording, while ordinary links still work', async (t) => {
  const client = new Client({ name: 'viewer-view-target-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))], env }));
  t.after(() => client.close());
  const raw = (name, args) => client.callTool({ name, arguments: args });
  const call = async (name, args) => { const result = await raw(name, args); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const relations = registerRequest.model.meaning_model.event_relations;
  const template = relations.find((relation) => relation.id === 'offer.enables.state');
  relations.push({ ...template, id: 'native.about', kind: 'about' },
    { ...template, id: 'legacy.about', kind: 'other', description: 'ABOUT the attention state.' },
    { ...template, id: 'ordinary.other', kind: 'other', description: 'Aboutness is this authored relation\'s name.' });
  const registered = await call('life_model_register', registerRequest);
  graphRequest.narrativeGraph.source.model_hash = registered.modelHash;
  const stored = await call('life_narrative_register', graphRequest);
  const request = { graphHash: stored.graphHash, requestId: 'view-targets', accessScopes: ['author'], holder: 'modeler', title: 'View', caption: 'What matters.' };
  for (const relationId of ['world.contains.offer', 'native.about', 'legacy.about']) for (const nested of [false, true]) {
    const highlights = [{ record: `event_relation:${relationId}`, why: 'This relation matters.' }];
    const result = await raw('life_model_viewer_view', { ...request, ...(nested ? { levels: [{ label: '+ detail', highlights }] } : { highlights }) });
    assert.ok(result.isError, `${relationId} must be refused ${nested ? 'in a level' : 'in the base view'}`);
    assert.match(JSON.stringify(result.content), /containment or about link.*does not support as a highlight/u);
  }
  const missing = await raw('life_model_viewer_view', { ...request, highlights: [{ record: 'event_relation:missing', why: 'Unknown.' }] });
  assert.ok(missing.isError);
  assert.match(JSON.stringify(missing.content), /not a record of the bound model/u);
  const supported = { ...request, highlights: ['offer.enables.state', 'ordinary.other'].map((relationId) => ({ record: `event_relation:${relationId}`, why: 'A displayed link.' })) };
  const recorded = await call('life_model_viewer_view', supported);
  assert.equal(recorded.previousGraphHash, stored.graphHash, 'refusals must not create graph revisions');
  assert.equal(recorded.supersedes, null);
  assert.deepEqual(await call('life_model_viewer_view', supported), recorded, 'a supported view retains retry semantics');
});

const view = { id: 'v2', level: 0, settings: { show: 'processes', camera: 'locked', t0: '1800', t1: '1876' }, rows: [{ record: 'cut:a' }],
  highlights: [{ record: 'event_relation:r1', why: 'It moves her.' }],
  levels: [{ label: '+ time', settings: { show: 'processes,causal' }, rows: [{ record: 'cut:b' }] }, { label: '+ notes', settings: { show: 'processes,causal,notes' }, highlights: [{ nodeId: 'n1', why: 'The reason.' }] }] };

test('levels add to the view in order, and Everything ends the slider without narrowing to the model\'s choice', () => {
  assert.deepEqual(settingsAt(view, 0), { show: 'processes', t0: '1800', t1: '1876' }, 'a view recorded with a camera opens without it');
  assert.deepEqual(settingsAt(view, 2), { show: 'processes,causal,notes', t0: '1800', t1: '1876' });
  assert.deepEqual(curationAt(view, 1).rows, [{ record: 'cut:a' }, { record: 'cut:b' }]);
  assert.deepEqual(curationAt(view, 2).highlights.map((item) => item.record ?? item.nodeId), ['event_relation:r1', 'n1']);
  assert.equal(everythingLevel(view), 3);
  assert.deepEqual(settingsAt(view, 3), { t0: '1800', t1: '1876', everything: '', rows: 'all' });
  assert.deepEqual(curationAt(view, 3), { rows: [], highlights: [] });
});

test('an address opens the model\'s view unless the reader has chosen, and a newer view is offered, not imposed', () => {
  const views = [{ ...view, id: 'v1', superseded: true }, view];
  const opened = openingView('https://x.test/m/?data=book', views);
  assert.equal(opened.state, 'following');
  assert.equal(new URL(opened.href).search, '?data=book&show=processes&t0=1800&t1=1876&chosen=v2');
  assert.ok(sameSettings('?show=processes&camera=free', '?show=processes'), 'turning the camera does not leave the view');
  assert.equal(openingView(opened.href, views).href, opened.href, 'an address on the current view stays as it is');
  assert.equal(openingView(`${opened.href}&level=2`, views).level, 2);
  const changed = openingView('https://x.test/m/?data=book&show=processes&chosen=v1', views);
  assert.deepEqual([changed.state, changed.previous, new URL(changed.href).searchParams.get('chosen')], ['changed', 'v1', 'v2']);
  const adjusted = openingView('https://x.test/m/?data=book&show=notes&chosen=v1&adjusted', views);
  assert.deepEqual([adjusted.state, adjusted.view.id, adjusted.newer, adjusted.href], ['adjusted', 'v1', true, 'https://x.test/m/?data=book&show=notes&chosen=v1&adjusted']);
  assert.equal(openingView('https://x.test/m/?data=book&show=notes&chosen=none', views).state, 'own');
  assert.equal(openingView('https://x.test/m/?data=book&show=notes', views).state, 'own', 'a link set by hand keeps its settings');
  assert.equal(openingView('https://x.test/m/?data=book&chosen=gone', views).state, 'following', 'a view no longer there opens the current one');
  assert.equal(openingView('https://x.test/m/?data=book', []).state, 'none');
  assert.equal(new URL(viewAddress('https://x.test/m/?data=book&live', view, 3)).search, '?data=book&live&t0=1800&t1=1876&everything&rows=all&chosen=v2&level=3');
  // Moving the camera, playing time or opening a passage does not leave the view.
  assert.ok(sameSettings('?show=processes&camera=locked&chosen=v2', '?camera=locked&show=processes&pose=1,2,3,4,5,6&at=1851.3&read&chosen=v2&level=1'));
  assert.ok(!sameSettings('?show=processes&camera=locked', '?show=processes,notes&camera=locked'));
});

test('life_model_viewer_view records the view as a decision about what it names and supersedes the previous one', async (t) => {
  const client = new Client({ name: 'viewer-view-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.ts', import.meta.url))], env }));
  t.after(() => client.close());
  const raw = (name, args) => client.callTool({ name, arguments: args });
  const call = async (name, args) => { const result = await raw(name, args); assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent; };
  const refused = async (args, pattern) => { const result = await raw('life_model_viewer_view', args); assert.ok(result.isError, `expected a refusal matching ${pattern}`); assert.match(JSON.stringify(result.content), pattern); };
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/gu)].map((match) => JSON.parse(match[1]));
  const accessScopes = ['author'];
  const registered = await call('life_model_register', registerRequest);
  const graph = graphRequest.narrativeGraph;
  graph.source.model_hash = registered.modelHash;
  graph.nodes = graph.nodes.map((node) => ({ ...node, access_scopes: accessScopes }));
  graph.edges = graph.edges.map((edge) => ({ ...edge, access_scopes: accessScopes }));
  const stored = await call('life_narrative_register', { requestId: 'view-graph', narrativeGraph: graph });
  const noted = await call('life_understanding_record', { requestId: 'view-notes', graphHash: stored.graphHash, holder: 'modeler', accessScopes,
    notes: [{ nodeId: 'note.offer', kind: 'interpretation', text: 'The offer is what frees her attention.', about: [{ record: 'event:event.offer' }] }] });
  const request = (requestId, title) => ({ requestId, graphHash: noted.graphHash, accessScopes, holder: 'modeler', title,
    caption: 'How the offer moves Ada\'s attention, and the reason.', settings: { show: 'processes,causal', view: 'together' },
    rows: [{ record: 'cut:cut.ada.h06.attention' }],
    highlights: [{ record: 'event_relation:offer.enables.state', why: 'The offer opens the evening state.' }, { nodeId: 'note.offer', why: 'The modeler\'s reason.' }],
    levels: [{ label: '+ the bakery\'s debt', rows: [{ record: 'process:bakery.debt_nok' }] }] });
  const first = await call('life_model_viewer_view', request('view-1', 'Ada\'s evening'));
  assert.deepEqual([first.viewId, first.supersedes, first.levels, first.highlights], ['understanding.view.view-1', null, 1, 2]);
  const second = await call('life_model_viewer_view', request('view-2', 'Ada\'s evening, again'));
  assert.deepEqual([second.viewId, second.supersedes], ['understanding.view.view-2', 'understanding.view.view-1']);
  const { notes } = await call('life_understanding_read', { graphHash: second.graphHash, accessScopes, nodeIds: ['understanding.view.view-2'] });
  assert.equal(notes[0].kind, 'decision');
  assert.match(JSON.stringify(notes[0]), /meaning-model-view\/v1/u);

  // The snapshot lists the views and names the current one; views are not drawn as notes, and links carry their ids so
  // a view can highlight one.
  const opened = await call('life_model_viewer_open', { graphHash: second.graphHash, accessScopes });
  const data = await (await fetch(new URL('data/model.json', opened.url))).json();
  assert.deepEqual(data.views.map((item) => [item.id, item.superseded]), [['understanding.view.view-1', true], ['understanding.view.view-2', false]]);
  assert.equal(data.chosenView, 'understanding.view.view-2');
  const chosen = data.views[1];
  assert.deepEqual([chosen.title, chosen.settings, chosen.levels[0].label, chosen.highlights[0].why], ['Ada\'s evening, again', { show: 'processes,causal', view: 'together' }, '+ the bakery\'s debt', 'The offer opens the evening state.']);
  assert.ok(data.graph.nodes.some((node) => node.id === 'note.offer') && !data.graph.nodes.some((node) => node.id.startsWith('understanding.view.')));
  assert.ok(data.relations.some((relation) => relation.id === 'offer.enables.state'));

  await refused({ ...request('bad-1', 'x'), settings: { colour: 'red' } }, /colour is not a viewer setting/u);
  await refused({ ...request('bad-2', 'x'), settings: { scope: 'event.nowhere' } }, /scope names event\.nowhere, which is not an Event/u);
  await refused({ ...request('bad-2b', 'x'), settings: { importance: 'importance.nowhere' } }, /importance names importance\.nowhere, which is not an importance scale/u);
  await refused({ ...request('bad-3', 'x'), highlights: [{ record: 'event_relation:no.such.link', why: 'x' }] }, /not a record of the bound model/u);
  await refused({ ...request('bad-4', 'x'), rows: [{ record: 'event:event.offer' }] }, /a row is shown for a Cut or a process/u);
  await refused({ ...request('bad-5', 'x'), level: 2 }, /level 2 is past the 1 levels given/u);
});
