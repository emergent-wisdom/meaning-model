import assert from 'node:assert/strict';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { recordUnderstanding } from '../src/construction-record.mjs';
import { eraQuestions, worldRecordSchema } from '../src/storytelling-world.mjs';
import { directorPrinciples } from '../src/storytelling-director.mjs';

const provenance = ['documented era test'];
const model = (id, events) => ({ schema: 'life-sim-rust-model/v1', id, time_unit: 'year', revision: { number: 0, reason: 'Era test.', provenance },
  processes: [{ id: `${id}.clock`, value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } }, initial_value: { kind: 'scalar', value: 0 },
    uncertainty: { kind: 'exact' }, unit: 'fraction', provenance, support: ['world'], access_scopes: [] }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [], referents: [], event_referent_bindings: [],
    events: events.map(([eventId, description]) => ({ id: eventId, boundary: eventId, description, interval: { start: 0, end: 1 },
      process_ids: [], observation_process_ids: [], participants: {}, substrate: null, region: null, provenance })) } });

test('a documented fact is recorded as a report of its source, not as a belief', async (t) => {
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const world = await service.registerModel({ requestId: 'world', model: model('present-day', [['ev.datacenter', 'A new datacenter campus is announced outside the town.']]) });
  const graph = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: { schema: 'life-sim-rust-narrative-graph/v1', id: 'era-graph',
    revision: { number: 0, reason: 'Era test.', provenance }, source: { kind: 'model', model_hash: world.modelHash }, roots: ['book'],
    nodes: [{ id: 'book', node_type: 'story', role: 'document_root', epistemic_status: 'fictional_artifact', evidence_type: 'fictional_canon', access_scopes: [], provenance }], edges: [] } });
  const source = { citation: 'County planning board, minutes of the public hearing', url: 'https://example.org/minutes', published: '2026-03-02', reportsOn: '2026-02' };
  await assert.rejects(recordUnderstanding(service, { graphHash: graph.graphHash, requestId: 'bare', accessScopes: ['author'], holder: 'writer',
    notes: [{ nodeId: 'report.bare', kind: 'report', text: 'The campus was approved.', about: [{ record: 'event:ev.datacenter' }] }] }), /A report needs the source it rests on/);
  await assert.rejects(recordUnderstanding(service, { graphHash: graph.graphHash, requestId: 'idea', accessScopes: ['author'], holder: 'writer',
    notes: [{ nodeId: 'idea.sourced', kind: 'idea', text: 'The campus could be where the story starts.', source, about: [{ record: 'event:ev.datacenter' }] }] }), /Only a report carries a source/);
  const stored = await recordUnderstanding(service, { graphHash: graph.graphHash, requestId: 'report', accessScopes: ['author'], holder: 'writer',
    notes: [{ nodeId: 'report.hearing', kind: 'report', text: 'The planning board approved the campus after a public hearing in February 2026.', source, about: [{ record: 'event:ev.datacenter' }] },
      { nodeId: 'idea.hearing', kind: 'idea', text: 'The hearing is where the town first argues about what the campus is for.', links: [{ relation: 'learned_from', targetNodeId: 'report.hearing' }] }] });
  const view = await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const report = view.nodes.find((node) => node.id === 'report.hearing');
  assert.equal(report.evidence_type, 'report');
  assert.equal(report.authority.source, source.citation);
  assert.ok(report.provenance.includes(`source-url:${source.url}`) && report.provenance.includes('source-published:2026-03-02'));
  assert.deepEqual(JSON.parse(report.text).source, source);
  assert.equal(view.nodes.find((node) => node.id === 'idea.hearing').evidence_type, 'belief', 'a thought about the report stays a belief');
});

test('a real era asks for its cutoff, the modeler\'s knowledge limit and the living people it would touch', () => {
  assert.deepEqual(eraQuestions(null), [], 'no opening yet, no era questions');
  assert.deepEqual(eraQuestions({ era: null }).map((item) => item.kind), ['era-unstated']);
  assert.deepEqual(eraQuestions({ era: { kind: 'invented', documentaryCutoff: null, knowledgeLimit: null, livingPeople: null } }), []);
  const open = eraQuestions({ era: { kind: 'real', documentaryCutoff: null, knowledgeLimit: null, livingPeople: null } });
  assert.deepEqual(open.map((item) => item.kind), ['era-cutoff', 'era-knowledge', 'era-living-people']);
  assert.match(open.find((item) => item.kind === 'era-knowledge').question, /record each documented fact as a report with its source \(life_understanding_record, kind report\)/);
  assert.match(open.find((item) => item.kind === 'era-living-people').question, /Invent the people and companies that take their place/);
  assert.deepEqual(eraQuestions({ era: { kind: 'alternate', documentaryCutoff: '14 August 1843', knowledgeLimit: 'Documented sources to 1843.', livingPeople: 'None living.' } }), []);
  const parsed = worldRecordSchema.parse({ graphHash: 'a'.repeat(64), requestId: 'opening', nodeId: 'world.opening', storyRootId: 'book', authorId: 'writer', accessScopes: ['author'],
    summary: 'The opening of a present-day world.', world: { stage: 'opening', accounts: ['One.'.padEnd(120, ' x'), 'One.\n\nTwo.'.padEnd(120, ' x')],
      closedQuestions: ['Who holds the campus?', 'Where is the town?', 'When is the hearing?'], era: { kind: 'real', documentaryCutoff: '25 September 2026' } } });
  assert.deepEqual(parsed.world.era, { kind: 'real', documentaryCutoff: '25 September 2026', knowledgeLimit: null, livingPeople: null });
});

test('the director holds a real era to its sources and keeps living people out', () => {
  const documented = directorPrinciples.find((item) => item.id === 'world.documented');
  assert.equal(documented.stage, 'world');
  assert.equal(documented.canBeInapplicable, true, 'an invented world is not held to sources');
  assert.match(documented.principle, /documented up to a stated cutoff|document up to a stated cutoff/);
  assert.match(documented.principle, /Living people and real organizations do not take part as characters/);
  assert.match(directorPrinciples.find((item) => item.id === 'draft.documented').principle, /living people and real organizations do not take part/);
});
