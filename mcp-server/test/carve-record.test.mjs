// The conceptual decomposition as one recorded step: the change it makes, the notes it records on the real engine, and
// the values report's line about divisions that rest on no recorded carve.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LifeSimulationService } from '../src/service.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { carveChange, carveRecordSchema, clipBytes, openTemplates, outcomeOf, recordCarve } from '../src/carve-record.mjs';
import { carveReport, carvesOf } from '../src/carve-index.mjs';
import { valuesChange, valuesReport } from '../src/values-record.mjs';

const HASH = 'a'.repeat(64);
const pass = (reason = 'It holds.') => ({ verdict: 'pass', reason });
const fail = (reason = 'It does not hold.') => ({ verdict: 'fail', reason });
const unsure = (reason = 'Not yet known.') => ({ verdict: 'uncertain', reason });
const candidate = (key, label, tests = {}, extra = {}) => ({ key, label, meaning: `What ${label.toLowerCase()} covers.`,
  necessity: pass(), independence: pass(), universality: pass(), ...tests, ...extra });

// A bakery's survival, carved: three parts, a kind under one of them and a frontier alternative.
const carveInput = (overrides = {}) => carveRecordSchema.parse({
  requestId: 'carve-1', previousModelHash: HASH, holder: 'modeler', tag: 'exploring',
  concept: { id: 'concept.bakery-survival', label: 'A bakery\'s survival', process: 'bakery.standing' },
  frame: { concept: 'A small bakery staying open', purpose: 'To follow what keeps the bakery open through a hard year.', range: 'Every week of the bakery\'s life, from opening to the present.' },
  ascent: [
    { label: 'A small firm\'s survival', differentia: 'it bakes and sells fresh food each day, so it lives on daily cash', siblings: ['a workshop\'s survival', 'a shop\'s survival'] },
    { label: 'An organisation\'s survival', differentia: 'it sells to customers for money' },
  ],
  candidates: [
    candidate('cash', 'Cash on hand'),
    candidate('debt', 'Debt', {}, { processId: 'bakery.debt_nok' }),
    candidate('customers', 'Customers', {}, { measure: { unit: 'customers a week', meaning: 'Distinct paying customers in a week.' } }),
    candidate('bank-loan', 'A bank loan', { universality: fail('Not every bakery borrows from a bank.') }, { kindOf: 'debt' }),
    candidate('reputation', 'Reputation', { independence: unsure('It may only follow the customers.') }),
  ],
  completeness: { verdict: 'pass', reason: 'Every way the bakery could close runs through one of the parts.', checkedAgainst: 'a small-business failure checklist' },
  routing: [{ case: 'The oven breaks', homes: ['cash'] }, { case: 'A rival opens next door', homes: ['customers', 'reputation'] }],
  synthesis: 'Customers bring cash, cash pays the debt, and the bakery stays open while cash covers what falls due.',
  sema: ['ConceptualDecomposition#f1f4'],
  reason: 'Carve what keeps the bakery open.',
  // Cases are routed to these candidates; a test that changes the candidates routes its own cases.
  ...(overrides.candidates ? { routing: [] } : {}),
  ...overrides,
});
const baseModel = () => ({
  schema: 'life-sim-rust-model/v1', id: 'm', time_unit: 'week', revision: { number: 0, previous_model_hash: null, reason: 'r', provenance: ['p'] },
  processes: [{ id: 'bakery.debt_nok', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1e7 } }, initial_value: { kind: 'scalar', value: 400000 }, provenance: ['sketch'], support: ['s'],
    unit: 'NOK', scale: { semantic_role: 'Debt: NOK owed', label: 'Debt' } }],
  decomposition: [], dependencies: [], laws: [], initial_claims: [],
  meaning_model: { schema: 'life-sim-rust-meaning-model/v1', concepts: [{ id: 'concept.old', label: 'Old', differentia: [], boundary: null, state_schema: {}, direction_families: [], observation_methods: [], provenance: ['p'] }] },
});

test('a candidate is a part only when the three tests pass; a kind fails universality alone; the rest stay frontier', () => {
  assert.equal(outcomeOf(candidate('a', 'A')), 'part');
  assert.equal(outcomeOf(candidate('a', 'A', { universality: fail() })), 'kind');
  assert.equal(outcomeOf(candidate('a', 'A', { universality: unsure() })), 'frontier');
  assert.equal(outcomeOf(candidate('a', 'A', { necessity: fail(), universality: fail() })), 'frontier');
  assert.equal(outcomeOf(candidate('a', 'A', { independence: fail() }, { outcome: 'merged' })), 'merged');
  assert.throws(() => outcomeOf(candidate('a', 'A', { independence: unsure() }, { outcome: 'part' })), /kept as a part, but independence is uncertain/);
});

test('the change adds the concepts it lacks, the climb as kind-of relations, and the cut naming its processes', () => {
  const { change, plan } = carveChange(baseModel(), carveInput());
  const concepts = new Map(change.upsert.concepts.map((concept) => [concept.id, concept]));
  assert.deepEqual([...concepts.keys()].sort(), ['concept.small-firms-survival', 'concept.organisations-survival', 'concept.bakery-survival',
    'concept.bakery-survival.cash', 'concept.bakery-survival.customers', 'concept.bakery-survival.debt', 'concept.bakery-survival.debt.bank-loan'].sort());
  // Each concept's differentia is what sets it apart within the kind above it.
  assert.deepEqual(concepts.get('concept.bakery-survival').differentia, ['it bakes and sells fresh food each day, so it lives on daily cash']);
  assert.deepEqual(concepts.get('concept.small-firms-survival').differentia, ['it sells to customers for money']);
  // Specialization runs from the general to the specific.
  const relations = change.upsert.abstract_relations.map((relation) => [relation.source_concept_id, relation.target_concept_id]);
  assert.deepEqual(relations, [['concept.small-firms-survival', 'concept.bakery-survival'], ['concept.organisations-survival', 'concept.small-firms-survival'],
    ['concept.bakery-survival.debt', 'concept.bakery-survival.debt.bank-loan']]);
  const [cut] = change.upsert.abstract_cuts;
  assert.equal(cut.id, 'carve.concept.bakery-survival');
  assert.deepEqual(cut.child_concept_ids, ['concept.bakery-survival.cash', 'concept.bakery-survival.debt', 'concept.bakery-survival.customers']);
  assert.ok(cut.provenance.includes('divides-process:bakery.standing'));
  assert.ok(cut.provenance.includes('part:concept.bakery-survival.debt=bakery.debt_nok'));
  assert.ok(cut.provenance.includes('tested reputation: necessity pass, independence uncertain, universality pass; frontier'));
  assert.ok(cut.provenance.includes('sema:ConceptualDecomposition#f1f4'));
  assert.deepEqual(plan.frontier.map((item) => [item.key, item.open]), [['reputation', ['independence']]]);
  // The change applies, and the index reads the carve back from the cut alone.
  const successor = applyModelChange(baseModel(), HASH, change).successor;
  assert.deepEqual(carvesOf(successor).map((carve) => [carve.process, carve.parts.map((part) => part.processId)]),
    [['bakery.standing', ['bakery.standing.cash', 'bakery.debt_nok', 'bakery.standing.customers']]]);
});

test('the parts are not opened: each comes back as a template that says what it still needs', () => {
  const input = carveInput();
  const { plan } = carveChange(baseModel(), input);
  const templates = openTemplates(plan, input);
  assert.deepEqual(templates.map((item) => item.processId), ['bakery.standing', 'bakery.standing.cash', 'bakery.debt_nok', 'bakery.standing.customers']);
  assert.ok(templates[0].needs.some((need) => /number test/.test(need)), 'the whole needs a measure too');
  assert.equal(templates[1].process.parent, 'bakery.standing');
  assert.ok(!('unit' in templates[1].process), 'no unit is invented');
  assert.deepEqual(templates[2], { processId: 'bakery.debt_nok', process: { parent: 'bakery.standing' }, needs: [] }, 'an existing process is filed under the whole as it is');
  assert.equal(templates[3].process.unit, 'customers a week', 'a measure given in the carve is carried');
  // A template cannot be sent as it is: life_values_record refuses a new process without a value.
  assert.throws(() => valuesChange(baseModel(), { holder: 'modeler', reason: 'r', values: [templates[1]] }), /unit|value/);
  const cut = carveInput({ form: 'cut' });
  const [series] = openTemplates(carveChange(baseModel(), cut).plan, cut);
  assert.equal(series.tool, 'life_series_record');
  assert.deepEqual(series.series.answers.map((answer) => answer.key), ['cash', 'debt', 'customers']);
});

test('existing concepts are never edited, fewer than two parts records no cut, and a carve can withdraw the one it replaces', () => {
  const model = baseModel();
  const { change } = carveChange(model, carveInput({ concept: { id: 'concept.old', label: 'New label', process: 'bakery.standing' } }));
  assert.ok(!change.upsert.concepts.some((concept) => concept.id === 'concept.old'), 'the existing concept is left as it is');
  const one = carveChange(model, carveInput({ candidates: [candidate('cash', 'Cash'), candidate('luck', 'Luck', { necessity: fail() })] }));
  assert.equal(one.plan.cutRecorded, false);
  assert.ok(!one.change.upsert.abstract_cuts, 'no cut with a single part');
  assert.ok(one.change.upsert.concepts.some((concept) => concept.id === 'concept.bakery-survival.cash'), 'the concepts are still recorded');
  const first = applyModelChange(model, HASH, carveChange(model, carveInput()).change).successor;
  const replaced = carveChange(first, carveInput({ cutId: 'carve.bakery.v2', supersedes: 'carve.concept.bakery-survival' })).change;
  const old = replaced.upsert.abstract_cuts.find((cut) => cut.id === 'carve.concept.bakery-survival');
  assert.deepEqual(old.withdrawn.superseded_by, ['carve.bakery.v2']);
  assert.throws(() => carveChange(first, carveInput({ supersedes: 'carve.concept.bakery-survival' })), /same id already revises it/);
  assert.equal(carveChange(first, carveInput({ cutId: 'carve.bakery.v2' })).plan.besides[0], 'carve.concept.bakery-survival', 'another current carve is named, not withdrawn');
  assert.throws(() => carveInput({ routing: [{ case: 'x', homes: ['nowhere'] }] }), /not a candidate key/);
});

test('long texts are clipped at a character boundary to the 1,024-byte fields; the reasons stay whole in the notes', () => {
  assert.equal(clipBytes('short'), 'short');
  const long = 'å'.repeat(800);
  const clipped = clipBytes(long);
  assert.ok(Buffer.byteLength(clipped, 'utf8') <= 1_000);
  assert.ok(clipped.endsWith('…') && !clipped.includes('�'));
  const { change } = carveChange(baseModel(), carveInput({ frame: { concept: 'A bakery', purpose: 'p'.repeat(1_900), range: 'r'.repeat(1_900) } }));
  const [cut] = change.upsert.abstract_cuts;
  assert.ok(Buffer.byteLength(cut.lens, 'utf8') <= 1_024);
  for (const line of cut.provenance) assert.ok(Buffer.byteLength(line, 'utf8') <= 1_024, line.slice(0, 40));
});

test('the values report names divisions without a recorded carve, parts not yet opened and parts never tested', () => {
  let model = baseModel();
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'm', reason: 'r', values: [
    { processId: 'world', process: { label: 'The world', unit: 'index' }, points: [{ time: 0, value: 1, tag: 'sketch' }] },
    { processId: 'world.a', process: { label: 'A', unit: 'index', parent: 'world' }, points: [{ time: 0, value: 1, tag: 'sketch' }] },
    { processId: 'world.b', process: { label: 'B', unit: 'index', parent: 'world' }, points: [{ time: 0, value: 1, tag: 'sketch' }] },
    // A person's nine slow processes are the method's fixed top of a life, not a carve.
    ...['body', 'kin', 'work', 'place', 'means'].map((key) => ({ processId: `ada.${key}`, process: { label: key, unit: 'index', parent: 'world.a' }, points: [{ time: 0, value: 1, tag: 'sketch' }] })),
  ] })).successor;
  let report = carveReport(model);
  assert.deepEqual(report.uncarved.map((item) => item.process), ['world']);
  // A world whose parts happen to share names with slow processes is still asked for its carve.
  const economy = applyModelChange(model, HASH, valuesChange(model, { holder: 'm', reason: 'r', values: [
    { processId: 'h', process: { label: 'Humanity', unit: 'index' }, points: [{ time: 0, value: 1, tag: 'sketch' }] },
    ...['means', 'meaning', 'standing', 'work', 'place', 'war', 'trade', 'law', 'art', 'faith', 'farms', 'towns'].map((key) => ({ processId: `h.${key}`, process: { label: key, unit: 'index', parent: 'h' }, points: [{ time: 0, value: 1, tag: 'sketch' }] })),
  ] })).successor;
  assert.ok(carveReport(economy).uncarved.some((item) => item.process === 'h' && item.parts === 12));
  assert.match(valuesReport(model).next.join('\n'), /1 process\(es\) are divided without a recorded carve, beginning with The world \(2 parts\): record why these are the parts with life_carve_record/);
  assert.equal(valuesReport(model).uncarvedCount, 1);
  // Carved: the division is accounted for, the part still to open is named, and a part filed later without a test too.
  const input = carveInput({ concept: { id: 'concept.world', label: 'The world', process: 'world' },
    candidates: [candidate('a', 'A', {}, { processId: 'world.a' }), candidate('b', 'B', {}, { processId: 'world.b' }), candidate('c', 'C')] });
  model = applyModelChange(model, HASH, carveChange(model, input).change).successor;
  report = carveReport(model);
  assert.deepEqual(report.uncarved, []);
  assert.deepEqual(report.unopened.map((item) => item.processId), ['world.c']);
  model = applyModelChange(model, HASH, valuesChange(model, { holder: 'm', reason: 'r', values: [
    { processId: 'world.c', process: { label: 'C', unit: 'index', parent: 'world' }, points: [{ time: 0, value: 1, tag: 'sketch' }] },
    { processId: 'world.d', process: { label: 'D', unit: 'index', parent: 'world' }, points: [{ time: 0, value: 1, tag: 'sketch' }] },
  ] })).successor;
  report = carveReport(model);
  assert.deepEqual(report.unopened, []);
  assert.deepEqual(report.outside.map((item) => item.child), ['world.d']);
  assert.match(valuesReport(model).next.join('\n'), /1 part\(s\) sit under a carved process without being tested in its carve, such as D under The world/);
  assert.ok(!valuesReport(model).next.some((line) => /divided without a recorded carve/.test(line)));
});

async function setup(t) {
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest, graphRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const service = new LifeSimulationService();
  t.after(() => service.close());
  await service.initialize();
  const registered = await service.registerModel({ requestId: 'model', model: registerRequest.model });
  const graph = structuredClone(graphRequest.narrativeGraph);
  graph.source.model_hash = registered.modelHash;
  graph.nodes = graph.nodes.map((node) => ({ ...node, access_scopes: ['author'] }));
  graph.edges = graph.edges.map((edge) => ({ ...edge, access_scopes: ['author'] }));
  const stored = await service.registerNarrativeGraph({ requestId: 'graph', narrativeGraph: graph });
  return { service, modelHash: registered.modelHash, graphHash: stored.graphHash };
}

test('on the engine: one call revises the model, rebinds the graph and records the frame, the tests and the synthesis', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const long = 'Because '.repeat(240).trim();
  const input = { ...carveInput(), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] },
    frame: { concept: 'A small bakery staying open', purpose: `To follow what keeps the bakery open. ${'p'.repeat(1_900)}`, range: 'Every week of its life.' } };
  input.candidates[0] = { ...input.candidates[0], necessity: pass(long.slice(0, 2_000)) };
  const result = await recordCarve(service, input);
  assert.ok(!result.partial, JSON.stringify(result.failure));
  assert.equal(result.schema, 'meaning-model-carve-record/v1');
  assert.notEqual(result.modelHash, modelHash);
  assert.equal(result.carve.recorded, true);
  assert.deepEqual(result.carve.parts.map((part) => [part.key, part.process]), [['cash', 'to open'], ['debt', 'to file'], ['customers', 'to open']]);
  const { model } = await service.inspectModel({ modelHash: result.modelHash, includeDefinition: true });
  const cut = model.meaning_model.abstract_cuts.find((item) => item.id === 'carve.concept.bakery-survival');
  assert.equal(cut.child_concept_ids.length, 3);
  assert.deepEqual(model.processes.map((process) => process.id), ['bakery.debt_nok'], 'no process is opened or edited');
  // The notes: held by the modeler, about the concept, the cut and the climb, with every reason whole.
  const attempt = (requestId) => createHash('sha256').update(requestId).digest('hex').slice(0, 10);
  const prefix = `note.carve.concept.bakery-survival.r${model.revision.number}.${attempt('carve-1')}`;
  assert.deepEqual(result.graph.noteIds, [`${prefix}.frame`, `${prefix}.tests`, `${prefix}.synthesis`]);
  const view = await service.queryNarrativeGraph({ graphHash: result.graph.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  assert.equal(view.graph.source.model_hash, result.modelHash, 'the graph is rebound to the revision');
  const anchors = (nodeId) => view.edges.filter((edge) => edge.source?.node_id === nodeId && edge.target?.kind === 'anchor').map((edge) => `${edge.target.anchor_kind}:${edge.target.anchor_id}`);
  assert.ok(anchors(`${prefix}.frame`).includes('abstract_relation:spec.concept.small-firms-survival.concept.bakery-survival'));
  assert.ok(anchors(`${prefix}.tests`).includes('abstract_cut:carve.concept.bakery-survival'));
  const testsNote = JSON.parse(view.nodes.find((node) => node.id === `${prefix}.tests`).text);
  assert.ok(testsNote.text.includes(long.slice(0, 2_000)), 'the whole reason is in the note');
  assert.deepEqual(testsNote.data.candidates.find((item) => item.key === 'reputation'), { key: 'reputation', label: 'Reputation', outcome: 'frontier', necessity: 'pass', independence: 'uncertain', universality: 'pass' });
  assert.match(testsNote.text, /Reputation \(reputation\): frontier\.\n/);
  assert.match(testsNote.text, /A bank loan \(bank-loan\): a kind of debt\./);
  const frameNote = JSON.parse(view.nodes.find((node) => node.id === `${prefix}.frame`).text);
  assert.match(frameNote.text, /Every week of its life\.\n\nThe climb before the carve/);
  assert.match(frameNote.text, /daily cash\. Other kinds within it: a workshop's survival/);
  const synthesis = JSON.parse(view.nodes.find((node) => node.id === `${prefix}.synthesis`).text);
  assert.match(synthesis.text, /Routing sample: 2 case\(s\); 0 with no home among the parts; 0 with two or more parts as homes\./);

  // Carving again under the same id revises the carve, and its notes supersede the earlier ones.
  const again = await recordCarve(service, { ...carveInput({ requestId: 'carve-2' }), previousModelHash: result.modelHash, graph: { graphHash: result.graph.graphHash, accessScopes: ['author'] },
    candidates: [...carveInput().candidates.slice(0, 4), candidate('reputation', 'Reputation', { independence: pass('Word of mouth outlasts a bad month of customers.') })] });
  assert.ok(!again.partial, JSON.stringify(again.failure));
  assert.equal(again.carve.revised, true);
  assert.deepEqual(again.carve.parts.map((part) => part.key), ['cash', 'debt', 'customers', 'reputation']);
  const later = await service.queryNarrativeGraph({ graphHash: again.graph.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const supersedes = later.edges.filter((edge) => edge.relation === 'supersedes').map((edge) => [edge.source.node_id, edge.target.node_id]);
  assert.ok(supersedes.some(([from, to]) => from.endsWith('.synthesis') && to === `${prefix}.synthesis`), JSON.stringify(supersedes));
  assert.ok(supersedes.some(([from, to]) => from.endsWith('.tests') && to === `${prefix}.tests`));

  // Without a graph the model still carries one line per verdict, and the result says the reasons are missing.
  const bare = await recordCarve(service, { ...carveInput({ requestId: 'carve-3', cutId: 'carve.bakery.alt' }), previousModelHash: again.modelHash });
  assert.equal(bare.graph, null);
  assert.match(bare.next[0], /No graph was given/);
  assert.ok(bare.next.some((line) => /other current carves: carve\.concept\.bakery-survival/.test(line)));
});

test('a rebind that fails leaves the registered revision standing and says what to call next', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const result = await recordCarve(service, { ...carveInput(), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['nobody'] } });
  assert.equal(result.partial, true);
  assert.equal(result.failure.stage, 'rebind');
  assert.notEqual(result.modelHash, modelHash);
  assert.match(result.next[0], /The model revision is registered/);
  await service.inspectModel({ modelHash: result.modelHash });
});

test('through the real server: the tool is offered with its schema and records a carve', async (t) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const client = new Client({ name: 'carve-test', version: '0.1.0' });
  const env = { ...process.env, MEANING_MODEL_ADDONS: '' };
  delete env.LIFE_SIM_STATE_FILE;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, '..', 'src', 'server.ts')], env }));
  t.after(() => client.close());
  const tool = (await client.listTools()).tools.find((item) => item.name === 'life_carve_record');
  assert.ok(tool.inputSchema.properties.candidates && tool.inputSchema.properties.frame, 'the schema reaches the client');
  const markdown = await readFile(new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url), 'utf8');
  const [, registerRequest] = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  const registered = await client.callTool({ name: 'life_model_register', arguments: { requestId: 'model', model: registerRequest.model } });
  assert.ok(!registered.isError, JSON.stringify(registered).slice(0, 400));
  const { requestId: _requestId, previousModelHash: _hash, ...rest } = carveInput();
  const carved = await client.callTool({ name: 'life_carve_record', arguments: { ...rest, requestId: 'carve', previousModelHash: registered.structuredContent.modelHash } });
  assert.ok(!carved.isError, JSON.stringify(carved).slice(0, 600));
  assert.equal(carved.structuredContent.carve.recorded, true);
  assert.deepEqual(carved.structuredContent.open.map((item) => item.processId), ['bakery.standing', 'bakery.standing.cash', 'bakery.debt_nok', 'bakery.standing.customers']);
  const refused = await client.callTool({ name: 'life_carve_record', arguments: { ...rest, requestId: 'carve-bad', previousModelHash: registered.structuredContent.modelHash,
    routing: [], candidates: [{ ...rest.candidates[0], outcome: 'part', universality: { verdict: 'uncertain', reason: 'Not known.' } }, rest.candidates[1]] } });
  assert.ok(refused.isError);
  assert.match(JSON.stringify(refused.content), /kept as a part, but universality is uncertain/);
});

// ---- The deepen check and its answers (0.12.2) -----------------------------------------------------------------------------------
const fakeService = (model) => ({
  inspectModel: async () => ({ model: structuredClone(model) }),
  reviseModel: async () => ({ modelHash: 'b'.repeat(64) }),
});
const noParts = () => [
  candidate('rate', 'The interest rate', { universality: unsure('Some debt carries no interest.') }),
  candidate('lender', 'Who lends', { necessity: fail('The debt works the same whoever holds it.') }),
];

test('routing is read against the accepted parts: a case whose only home was set aside has none', () => {
  const input = carveInput({ routing: [{ case: 'The oven breaks', homes: ['cash'] }, { case: 'A bad review', homes: ['reputation'] }, { case: 'A loan is called in', homes: ['cash', 'debt'] }] });
  const { change, plan } = carveChange(baseModel(), input);
  assert.deepEqual(plan.noHome.map((item) => item.case), ['A bad review']);
  assert.deepEqual(plan.twoHomes.map((item) => item.case), ['A loan is called in']);
  const [cut] = change.upsert.abstract_cuts;
  assert.ok(cut.provenance.includes('routing: 3 case(s), 1 with no home among the parts, 1 with two or more'));
  // Without a graph the synthesis stays in the model, on the cut.
  assert.ok(cut.provenance.some((line) => line.startsWith('synthesis: Customers bring cash')));
});

test('the result warns where the verdicts and the routing sample disagree, and never refuses for it', async () => {
  const input = carveInput({ routing: [{ case: 'A bad review', homes: ['reputation'] }, { case: 'A loan is called in', homes: ['cash', 'debt'] }] });
  const result = await recordCarve(fakeService(baseModel()), input);
  assert.ok(result.next.some((line) => /^Completeness is recorded as pass, but 1 routed case\(s\) have no home among the parts, such as A bad review/.test(line)));
  assert.ok(result.next.some((line) => /belong to two parts whose independence passed, such as A loan is called in \(cash, debt\)/.test(line)));
  // A carve with no routing sample, and one where every candidate passed, are named.
  const bare = await recordCarve(fakeService(baseModel()), carveInput({ candidates: [candidate('cash', 'Cash on hand'), candidate('customers', 'Customers')] }));
  assert.ok(bare.next.some((line) => /^No routing sample was recorded/.test(line)));
  assert.ok(bare.next.some((line) => /^Every candidate became a part/.test(line)));
});

test('a carve without a climb says so on its cut', () => {
  const { change } = carveChange(baseModel(), carveInput({ ascent: [] }));
  assert.ok(change.upsert.abstract_cuts[0].provenance.includes('no-climb: carved before it was located among broader kinds'));
});

test('a climb step named only by a label the model already holds under another id is pointed out, not merged', () => {
  const model = baseModel();
  model.meaning_model.concepts.push({ ...model.meaning_model.concepts[0], id: 'concept.dim.firms', label: 'A small firm\'s survival' });
  const { plan } = carveChange(model, carveInput());
  assert.deepEqual(plan.sameLabel, [{ step: 'A small firm\'s survival', added: 'concept.small-firms-survival', existing: 'concept.dim.firms' }]);
});

test('carving a part of an earlier carve shows the frame it must serve', () => {
  const first = applyModelChange(baseModel(), HASH, carveChange(baseModel(), carveInput()).change).successor;
  const { plan } = carveChange(first, carveInput({ concept: { id: 'concept.bakery-survival.cash', process: 'bakery.cash' }, cutId: undefined }));
  assert.equal(plan.parentCarve.id, 'carve.concept.bakery-survival');
  assert.match(plan.parentCarve.lens, /To follow what keeps the bakery open/);
});

test('keepWhole records that a process stays whole, as a relation to its next broader kind, and edits nothing', () => {
  const input = carveInput({ concept: { id: 'concept.bakery-debt', label: 'The bakery\'s debt', process: 'bakery.debt_nok' }, candidates: noParts(),
    completeness: { verdict: 'uncertain', reason: 'No two parts hold.' }, keepWhole: { reason: 'One loan, one lender: nothing in it moves apart. Reopen if a second loan is taken.' } });
  const { change, plan } = carveChange(baseModel(), input);
  const relation = change.upsert.abstract_relations.find((item) => item.id === 'kept-whole.bakery.debt_nok');
  assert.deepEqual([relation.source_concept_id, relation.target_concept_id, relation.kind, relation.label], ['concept.bakery-debt', 'concept.small-firms-survival', 'other', 'kept whole']);
  assert.ok(relation.provenance.includes('kept-whole-process:bakery.debt_nok'));
  assert.ok(relation.provenance.includes('kept-whole-signals:events=0;unexplained=0'));
  assert.ok(!change.upsert.processes && !change.upsert.abstract_cuts);
  assert.equal(plan.kept.process, 'bakery.debt_nok');
  // The engine accepts it.
  applyModelChange(baseModel(), HASH, change);
});

test('keepWhole is refused when it contradicts the verdicts or cannot say what it stays whole as', () => {
  const kept = { keepWhole: { reason: 'Nothing to carve.' } };
  assert.throws(() => carveChange(baseModel(), carveInput({ ...kept, candidates: [candidate('cash', 'Cash on hand'), candidate('customers', 'Customers')], concept: { id: 'concept.bakery-debt', process: 'bakery.debt_nok' } })), /keepWhole contradicts the verdicts: cash, customers pass/);
  assert.throws(() => carveChange(baseModel(), carveInput({ ...kept, candidates: noParts(), concept: { id: 'concept.bakery-debt', process: 'bakery.none' } })), /name it in concept.process, a process the model has/);
  assert.throws(() => carveChange(baseModel(), carveInput({ ...kept, candidates: noParts(), ascent: [], concept: { id: 'concept.bakery-debt', process: 'bakery.debt_nok' } })), /keepWhole needs the climb/);
});

test('the deepen check ranks by what moves a process, leaves out what was kept whole, and brings it back when the evidence grows', async () => {
  const { deepenCheck, deepenLine } = await import('../src/deepen.mjs');
  const valued = new Map([['a', new Map([[0, { time: 0, value: 1, tag: 'inferred' }], [1, { time: 1, value: 2, tag: 'inferred' }]])],
    ['b', new Map([[0, { time: 0, value: 1, tag: 'sketch' }], [1, { time: 1, value: 2, tag: 'sketch' }]])]]);
  const event = (id, rank, names) => ({ id, rank, names: new Set(names) });
  const inputs = (events) => ({ candidates: [{ process: 'a', label: 'A', depth: 2 }, { process: 'b', label: 'B', depth: 2 }], happenings: events, unexplained: [], valued });
  const model = { meaning_model: { abstract_relations: [] } };
  // A moved by three Events at the top of a scale outranks B, rough but moved by nothing.
  const three = [event('e1', 1, ['a']), event('e2', 1, ['a']), event('e3', 2, ['a'])];
  let check = deepenCheck(model, inputs(three));
  assert.deepEqual(check.ranked.map((item) => item.process), ['a', 'b']);
  assert.match(deepenLine(check), /^Deepen check: is A made of parts worth following\? 3 Event\(s\) move it, 2 of them at the top/);
  // Kept whole with those three Events, A leaves the check; with two more it comes back, marked.
  model.meaning_model.abstract_relations.push({ id: 'kept-whole.a', provenance: ['x', 'kept-whole-process:a', 'kept-whole-signals:events=3;unexplained=0'] });
  check = deepenCheck(model, inputs(three));
  assert.deepEqual([check.ranked.map((item) => item.process), check.keptWhole], [['b'], ['a']]);
  check = deepenCheck(model, inputs([...three, event('e4', 3, ['a']), event('e5', 3, ['a'])]));
  assert.equal(check.ranked.find((item) => item.process === 'a').keptWholeBefore, true);
});

test('on the engine: a decision to keep a process whole is stored and leaves it out of the deepen check', async (t) => {
  const { service, modelHash } = await setup(t);
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const process = model.processes[0].id;
  const result = await recordCarve(service, carveRecordSchema.parse({ requestId: 'keep', previousModelHash: modelHash, holder: 'modeler', tag: 'exploring',
    concept: { id: 'concept.kept', label: 'Kept', process }, frame: { concept: 'One quantity', purpose: 'To see whether it has parts worth following.', range: 'Its whole span.' },
    ascent: [{ label: 'A broader kind' }], candidates: noParts(), completeness: { verdict: 'uncertain', reason: 'No two parts hold.' },
    synthesis: 'It works as one.', keepWhole: { reason: 'Nothing in it moves apart.' }, reason: 'Examine it for a carve.' }));
  assert.equal(result.revisedByChange, true);
  assert.match(result.next[1], /^Kept is kept whole: the deepen check leaves .* out until the Events that move it \(\d+ now\)/);
  const { model: after } = await service.inspectModel({ modelHash: result.modelHash, includeDefinition: true });
  const relation = after.meaning_model.abstract_relations.find((item) => item.id === `kept-whole.${process}`);
  assert.deepEqual([relation.kind, relation.label, relation.target_concept_id], ['other', 'kept whole', 'concept.broader-kind']);
  assert.ok(!(valuesReport(after).deepen ?? []).some((item) => item.process === process));
});

// ---- Scoped readings, retries and repeated attempts -----------------------------------------------------------------
test('a scoped values report never names a carve part the reader cannot see, and still names one that is missing', async () => {
  const { questionModel } = await import('../src/model-questions.mjs');
  const model = baseModel();
  model.processes[0].access_scopes = ['private'];
  const carved = applyModelChange(model, HASH, carveChange(model, carveInput()).change).successor;
  const outside = valuesReport(questionModel(carved, []));
  assert.ok(!JSON.stringify(outside).includes('bakery.debt_nok'), 'the hidden process is not named');
  assert.ok(outside.unopenedParts.some((item) => item.processId === 'bakery.standing.cash'), 'a part that is missing is still named');
  const inside = valuesReport(questionModel(carved, ['private']));
  assert.ok(!inside.unopenedParts.some((item) => item.processId === 'bakery.debt_nok'), 'in its scope the process exists, so it is not missing');
  assert.ok(inside.unopenedParts.some((item) => item.processId === 'bakery.standing.cash'));
});

test('on the engine: an exact retry of a carve that revised an earlier one records the same notes', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const first = await recordCarve(service, { ...carveInput(), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  assert.ok(!first.partial, JSON.stringify(first.failure));
  const second = { ...carveInput({ requestId: 'carve-2' }), previousModelHash: first.modelHash, graph: { graphHash: first.graph.graphHash, accessScopes: ['author'] },
    candidates: [...carveInput().candidates.slice(0, 4), candidate('reputation', 'Reputation', { independence: pass('Word of mouth outlasts a bad month.') })] };
  const once = await recordCarve(service, structuredClone(second));
  assert.ok(!once.partial, JSON.stringify(once.failure));
  const retry = await recordCarve(service, structuredClone(second));
  assert.ok(!retry.partial, JSON.stringify(retry.failure));
  assert.deepEqual([retry.modelHash, retry.graph.graphHash, retry.graph.noteIds], [once.modelHash, once.graph.graphHash, once.graph.noteIds]);
});

test('on the engine: a second attempt that changes nothing in the model records its own notes and supersedes the first', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const attemptInput = (requestId, synthesis, previous, graph) => ({ ...carveInput({ requestId, candidates: noParts(), concept: { id: 'concept.test', label: 'Test' },
    completeness: { verdict: 'uncertain', reason: 'No two parts hold.' }, synthesis }), previousModelHash: previous, graph: { graphHash: graph, accessScopes: ['author'] } });
  const first = await recordCarve(service, attemptInput('try-1', 'Not yet a carve.', modelHash, graphHash));
  assert.ok(!first.partial, JSON.stringify(first.failure));
  assert.equal(first.carve.recorded, false);
  const second = await recordCarve(service, attemptInput('try-2', 'Still not a carve, for a new reason.', first.modelHash, first.graph.graphHash));
  assert.ok(!second.partial, JSON.stringify(second.failure));
  assert.equal(second.revisedByChange, false, 'nothing new in the model');
  assert.notDeepEqual(second.graph.noteIds, first.graph.noteIds);
  const view = await service.queryNarrativeGraph({ graphHash: second.graph.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const supersedes = view.edges.filter((edge) => edge.relation === 'supersedes').map((edge) => [edge.source.node_id, edge.target.node_id]);
  for (const part of ['frame', 'tests', 'synthesis']) {
    assert.ok(supersedes.some(([from, to]) => from === second.graph.noteIds.find((id) => id.endsWith(`.${part}`)) && to === first.graph.noteIds.find((id) => id.endsWith(`.${part}`))), `${part}: ${JSON.stringify(supersedes)}`);
  }
});

test('on the engine: a long climb is recorded across as many frame notes as it needs, each within a note\'s limit', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const sibling = (step, n) => `a sibling kind ${step}.${n} ${'with a long name '.repeat(16)}`.slice(0, 300);
  const ascent = Array.from({ length: 8 }, (_, step) => ({ label: `Broader kind ${step + 1}`, differentia: 'd'.repeat(1_000), siblings: Array.from({ length: 32 }, (_, n) => sibling(step, n)) }));
  const result = await recordCarve(service, { ...carveInput({ requestId: 'long-climb', ascent }), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  assert.ok(!result.partial, JSON.stringify(result.failure));
  const frames = result.graph.noteIds.filter((id) => /\.frame(-\d+)?$/u.test(id));
  assert.ok(frames.length > 1, 'more than one frame note');
  const view = await service.queryNarrativeGraph({ graphHash: result.graph.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const texts = frames.map((id) => JSON.parse(view.nodes.find((node) => node.id === id).text).text);
  assert.ok(texts.every((text) => text.length <= 64_000), texts.map((text) => text.length).join(', '));
  for (let step = 1; step <= 8; step += 1) assert.equal(texts.filter((text) => text.includes(`is a kind of Broader kind ${step}`)).length, 1, `step ${step} is in one note`);
});

test('a carve of many parts returns its result within the size it declares', async () => {
  const many = Array.from({ length: 32 }, (_, n) => candidate(`part-${n}`, `Part ${n}`, { necessity: pass('r'.repeat(1_200)), independence: pass('r'.repeat(1_200)), universality: pass('r'.repeat(1_200)) }));
  const result = await recordCarve(fakeService(baseModel()), carveInput({ candidates: many }));
  const size = JSON.stringify(result).length;
  assert.ok(size > 0 && size < 500_000, `${size}`);
});

test('on the engine: an exact retry made after later carves moved the graph on returns its first result', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const variant = (_requestId, reason) => [...carveInput().candidates.slice(0, 4), candidate('reputation', 'Reputation', { independence: pass(reason) })];
  const c1 = await recordCarve(service, { ...carveInput(), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  const c2input = { ...carveInput({ requestId: 'carve-2' }), previousModelHash: c1.modelHash, graph: { graphHash: c1.graph.graphHash, accessScopes: ['author'] }, candidates: variant('carve-2', 'Word of mouth outlasts a bad month.') };
  const c2 = await recordCarve(service, structuredClone(c2input));
  const c3 = await recordCarve(service, { ...carveInput({ requestId: 'carve-3', candidates: [...carveInput().candidates.slice(0, 4)] }), previousModelHash: c2.modelHash,
    graph: { graphHash: c2.graph.graphHash, accessScopes: ['author'] } });
  for (const result of [c1, c2, c3]) assert.ok(!result.partial, JSON.stringify(result.failure));
  const before = (await service.listNarrativeRevisions({})).revisions.length;
  const retry = await recordCarve(service, structuredClone(c2input));
  assert.ok(!retry.partial, JSON.stringify(retry.failure));
  assert.deepEqual([retry.modelHash, retry.graph.graphHash, retry.graph.noteIds], [c2.modelHash, c2.graph.graphHash, c2.graph.noteIds]);
  assert.equal((await service.listNarrativeRevisions({})).revisions.length, before, 'no new graph revision');
});

// A large carve: 32 candidates with 2,000-character reasons and a long climb with many sibling kinds.
const largeCarve = (requestId, steps, count = 32) => carveInput({ requestId,
  candidates: Array.from({ length: count }, (_, n) => candidate(`part-${n}`, `Part ${n}`, { necessity: pass('n'.repeat(2_000)), independence: pass('i'.repeat(2_000)), universality: pass('u'.repeat(2_000)) })),
  ascent: Array.from({ length: steps }, (_, step) => ({ label: `Broader kind ${step + 1}`, differentia: 'd'.repeat(1_000),
    siblings: Array.from({ length: 32 }, (_, n) => `sibling ${step}.${n} ${'s'.repeat(300)}`.slice(0, 300)) })) });
// The real engine with one note write that fails, the first time it is asked for.
const failingOnce = (service, suffix) => {
  let failed = false;
  return new Proxy(service, { get(target, property) {
    if (property === 'applyNarrativeBatch') return async (args) => { if (!failed && args.requestId.endsWith(suffix)) { failed = true; throw new Error('injected note-write failure'); } return target.applyNarrativeBatch(args); };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } });
};

test('on the engine: a large carve whose notes fail to write returns a result within its declared size, and replaying the call records them', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  // Fourteen steps and 32 candidates fit with the notes to send by hand; the largest carve the schema allows does not.
  const sample = await recordCarve(failingOnce(service, ':notes'), { ...largeCarve('sample', 14), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  assert.equal(sample.failure.stage, 'notes');
  assert.ok(JSON.stringify(sample).length < 500_000, `${JSON.stringify(sample).length}`);
  const fresh = await setup(t);
  const input = { ...largeCarve('large', 16, 48), previousModelHash: fresh.modelHash, graph: { graphHash: fresh.graphHash, accessScopes: ['author'] } };
  const failed = await recordCarve(failingOnce(fresh.service, ':notes'), structuredClone(input));
  assert.equal(failed.partial, true);
  assert.equal(failed.failure.stage, 'notes');
  assert.ok(JSON.stringify(failed).length < 500_000, `${JSON.stringify(failed).length}`);
  assert.equal(failed.retry, undefined, 'too large to carry the notes: the replay instead');
  assert.match(failed.next[0], /call life_carve_record again with exactly the same input, requestId large included/u);
  const replayed = await recordCarve(fresh.service, structuredClone(input));
  assert.ok(!replayed.partial, JSON.stringify(replayed.failure));
  assert.equal(replayed.modelHash, failed.modelHash, 'the stored revision');
  assert.ok(replayed.graph.noteIds.some((id) => id.endsWith('.synthesis')));
});

test('on the engine: a carve too large for one note write is written in batches that the next carve supersedes whole', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const writes = [];
  const counting = new Proxy(service, { get(target, property) {
    if (property === 'applyNarrativeBatch') return async (args) => { writes.push(args.requestId); return target.applyNarrativeBatch(args); };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const first = await recordCarve(counting, { ...largeCarve('batches', 16, 48), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  assert.ok(!first.partial, JSON.stringify(first.failure));
  assert.deepEqual(writes.filter((id) => id.startsWith('batches:notes')), ['batches:notes', 'batches:notes-2'], 'two batches');
  const revisions = (await service.listNarrativeRevisions({})).revisions.length;
  // A replay writes nothing new.
  const again = await recordCarve(service, { ...largeCarve('batches', 16, 48), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  assert.deepEqual([again.graph.graphHash, again.graph.noteIds], [first.graph.graphHash, first.graph.noteIds]);
  assert.equal((await service.listNarrativeRevisions({})).revisions.length, revisions);
  // The next carve of the same concept supersedes every note of the first, whichever batch held it.
  const next = await recordCarve(service, { ...carveInput({ requestId: 'after-batches' }), previousModelHash: first.modelHash, graph: { graphHash: first.graph.graphHash, accessScopes: ['author'] } });
  assert.ok(!next.partial, JSON.stringify(next.failure));
  const view = await service.queryNarrativeGraph({ graphHash: next.graph.graphHash, mode: 'full', includeContent: true, accessScopes: ['author'] });
  const superseded = new Set(view.edges.filter((edge) => edge.relation === 'supersedes').map((edge) => edge.target.node_id));
  assert.deepEqual(first.graph.noteIds.filter((id) => !superseded.has(id)), [], 'no note of the first carve is left current');
});

test('on the engine: a small carve whose notes fail still carries them to send by hand', async (t) => {
  const { service, modelHash, graphHash } = await setup(t);
  const failed = await recordCarve(failingOnce(service, ':notes'), { ...carveInput({ requestId: 'small' }), previousModelHash: modelHash, graph: { graphHash, accessScopes: ['author'] } });
  assert.equal(failed.failure.stage, 'notes');
  assert.equal(failed.retry.tool, 'life_understanding_record');
  assert.equal(failed.retry.arguments.notes.length, 3);
});
