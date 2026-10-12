import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifeSimulationService } from '../src/service.mjs';
import { RustEngineProcess } from '../src/rust-engine-process.mjs';
import { applyModelChange } from '../src/model-change.mjs';
import { forkStage } from '../src/futures.mjs';
import { assertBranchSourceTransition, branchesAlong, branchesOf, BRANCH_MARK } from '../src/model-lineage.mjs';
import { rebindNarrativeGraph } from '../src/narrative-rebind.mjs';
import { exportConstructionHistory } from '../src/construction-record.mjs';
import { buildViewerData } from '../src/viewer-data.mjs';
import { createModelViewer } from '../src/viewer-server.mjs';
import { definitionFromCompleteView } from '../src/narrative-delta.mjs';
import { harness } from './helpers/viewer-start-harness.mjs';

const provenance = ['branch guards integration test'];
const scopes = ['author'];
const event = (id, boundary, start, end) => ({ id, boundary, interval: { start, end }, participants: {},
  process_ids: [], observation_process_ids: [], region: null, substrate: null, provenance });
const contains = (id, source, target) => ({ id, kind: 'contains', source_event_id: source, target_event_id: target,
  description: 'Inside this context.', authority: null, uncertainty: { kind: 'unknown' }, provenance });
const definitionOf = async (service, modelHash) => (await service.inspectModel({ modelHash, includeDefinition: true })).model;
async function revise(service, previousModelHash, change, requestId) {
  const predecessor = await definitionOf(service, previousModelHash);
  return (await service.reviseModel({ requestId, previousModelHash,
    model: applyModelChange(predecessor, previousModelHash, change).successor })).modelHash;
}
async function fixture(t, service = new LifeSimulationService()) {
  await service.initialize();
  t.after(() => service.close());
  const registered = await service.registerModel({ requestId: 'guard.trunk', model: {
    schema: 'life-sim-rust-model/v1', id: 'guard-world', time_unit: 'year',
    revision: { number: 0, reason: 'A world with one issued forecast.', provenance },
    processes: [{ id: 'signal', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 1 } },
      initial_value: { kind: 'scalar', value: 0.5 }, update_mode: 'observed', unit: 'fraction',
      uncertainty: { kind: 'unknown' }, provenance, support: ['world'], access_scopes: [] }],
    decomposition: [], dependencies: [], laws: [], initial_claims: [],
    meaning_model: { schema: 'life-sim-rust-meaning-model/v1',
      events: [event('world', 'Accepted history', 0, 10), event('knowing', 'The forecaster\'s understanding', 0, 10),
        event('forecast', 'Forecast of rain by year 10', 0, 0.1)],
      event_relations: [contains('knowing.forecast', 'knowing', 'forecast')],
      normalized_cuts: [{ id: 'rain', parent_event_id: 'forecast', question: 'Will it rain by year 10?', unit: 'one unit of belief',
        answers: [{ key: 'yes', weight: 0.3 }, { key: 'no', weight: 0.6 }, { key: 'remainder', weight: 0.1 }],
        provenance: ['forecast: probabilities declared before the outcome', 'evidence cutoff: 0', 'horizon: 10', 'settled by: the rain gauge record'] }],
      context_roots: [{ event_id: 'world', kind: 'accepted_world', provenance }, { event_id: 'knowing', kind: 'understanding', provenance }] },
  } });
  const forked = await forkStage(service, { requestId: 'guard.fork', stageId: 'rain', title: 'Rain or no rain',
    trunkModelHash: registered.modelHash, kind: 'forecast', cutoff: 0, horizon: 10, forecast: { cutId: 'rain', window: { start: 0, end: 10 } },
    branches: ['yes', 'no'].map((key) => ({ key, premise: { boundary: key === 'yes' ? 'It rains by year 10.' : 'It does not rain by year 10.', description: `Assume ${key}.` } })),
    agentId: 'author', accessScopes: scopes });
  const graph = (modelHash, id) => ({ schema: 'life-sim-rust-narrative-graph/v1', id,
    revision: { number: 0, reason: 'An empty graph bound to this line.', provenance }, source: { kind: 'model', model_hash: modelHash },
    roots: [], nodes: [], edges: [] });
  return { service, trunk: registered.modelHash, forked, graph };
}

test('complete and delta narrative changes cannot enter a hypothetical fork, while same-line and replay changes remain valid', async (t) => {
  const { service, trunk, forked, graph } = await fixture(t);
  const branch = forked.branches[0];
  const original = graph(trunk, 'trunk-graph');
  const stored = await service.registerNarrativeGraph({ requestId: 'trunk.graph', narrativeGraph: original });
  const revision = { number: 1, previous_graph_hash: stored.graphHash, reason: 'Change the binding.', provenance };
  const source = { kind: 'model', model_hash: branch.modelHash };
  await assert.rejects(service.reviseNarrativeGraph({ requestId: 'complete.cross', previousGraphHash: stored.graphHash,
    narrativeGraph: { ...original, revision, source } }), /lies in branch yes/u);
  await assert.rejects(service.reviseNarrativeGraphByDelta({ requestId: 'delta.cross', previousGraphHash: stored.graphHash,
    delta: { revision, source }, accessScopes: scopes }), /lies in branch yes/u);
  await assert.rejects(rebindNarrativeGraph(service, { requestId: 'rebind.cross', graphHash: stored.graphHash,
    modelHash: branch.modelHash, accessScopes: scopes }), /lies in branch yes/u);
  assert.equal((await service.queryNarrativeGraph({ graphHash: stored.graphHash, mode: 'skeleton', accessScopes: scopes })).graph.source.model_hash, trunk);
  const nextTrunk = await revise(service, trunk, { reason: 'Accepted work.', upsert: { events: [event('observed', 'An observation', 1, 1)],
    event_relations: [contains('world.observed', 'world', 'observed')] } }, 'trunk.next');
  const continued = await service.reviseNarrativeGraphByDelta({ requestId: 'delta.trunk', previousGraphHash: stored.graphHash,
    delta: { revision, source: { kind: 'model', model_hash: nextTrunk } }, accessScopes: scopes });
  assert.equal(continued.stored, true);
  const nextBranch = await revise(service, branch.modelHash, { reason: 'Branch work.', upsert: { events: [event('assumed', 'An assumed consequence', 2, 2)],
    event_relations: [contains('world.assumed', 'world', 'assumed')] } }, 'branch.next');
  assert.equal((await rebindNarrativeGraph(service, { requestId: 'rebind.same', graphHash: branch.graphHash,
    modelHash: nextBranch, accessScopes: scopes })).modelHash, nextBranch);
  const branchView = await service.queryNarrativeGraph({ graphHash: branch.graphHash, mode: 'full', includeContent: true, accessScopes: scopes });
  const branchDefinition = definitionFromCompleteView(branchView);
  const branchRevision = { number: 1, previous_graph_hash: branch.graphHash, reason: 'Attempt to remove hypothetical status.', provenance };
  await assert.rejects(service.reviseNarrativeGraph({ requestId: 'complete.leave', previousGraphHash: branch.graphHash,
    narrativeGraph: { ...branchDefinition, revision: branchRevision, source: { kind: 'model', model_hash: trunk } } }), /discard hypothetical branch status/u);
  await assert.rejects(service.reviseNarrativeGraphByDelta({ requestId: 'delta.leave', previousGraphHash: branch.graphHash,
    delta: { revision: branchRevision, source: { kind: 'model', model_hash: trunk } }, accessScopes: scopes }), /discard hypothetical branch status/u);
  await assert.rejects(assertBranchSourceTransition(service, { kind: 'model', model_hash: nextBranch },
    { kind: 'world', world_id: 'world-view' }), /discard hypothetical branch status/u);
  await assert.rejects(assertBranchSourceTransition(service, { kind: 'model', model_hash: nextBranch },
    { kind: 'model', model_hash: forked.branches[1].modelHash }), /lies in branch no/u);
  // A faithful portable history replay uses the private import capability, rather than an interactive scope flag.
  const { NARRATIVE_HISTORY_REPLAY } = await import('../src/narrative-grounding.mjs');
  assert.equal((await service.reviseNarrativeGraphByDelta({ requestId: 'history.replay', previousGraphHash: stored.graphHash,
    delta: { revision, source }, accessScopes: scopes, [NARRATIVE_HISTORY_REPLAY]: true })).stored, true);
});

test('branch labels survive premise edits and removals and keep issued odds in portable and model-only views', async (t) => {
  const { service, trunk, forked } = await fixture(t);
  const branch = forked.branches[0];
  const model = await definitionOf(service, branch.modelHash);
  const premise = model.meaning_model.events.find((item) => item.id === branch.premiseEventId);
  const cut = model.meaning_model.normalized_cuts.find((item) => item.id === 'rain');
  const edited = await revise(service, branch.modelHash, { reason: 'Refine premise and reconsider the forecast.', upsert: {
    events: [{ ...premise, description: 'The premise was edited.', provenance: ['editor'] }],
    normalized_cuts: [{ ...cut, answers: [{ key: 'yes', weight: 0.9 }, { key: 'no', weight: 0 }, { key: 'remainder', weight: 0.1 }] }],
  } }, 'edit.premise');
  const rebinding = await rebindNarrativeGraph(service, { requestId: 'branch.graph.edit', graphHash: branch.graphHash,
    modelHash: edited, accessScopes: scopes });
  const portable = await buildViewerData({ history: await exportConstructionHistory(service, { graphHash: rebinding.graphHash, accessScopes: scopes }) });
  assert.deepEqual([portable.branch.stageId, portable.branch.key, portable.branch.probability], ['rain', 'yes', 0.3]);
  const current = await definitionOf(service, edited);
  const removed = await revise(service, edited, { reason: 'Withdraw this premise representation.', remove: {
    events: [branch.premiseEventId],
    event_relations: current.meaning_model.event_relations.filter((item) => item.target_event_id === branch.premiseEventId || item.source_event_id === branch.premiseEventId).map((item) => item.id),
  } }, 'remove.premise');
  const snapshots = [];
  const viewer = createModelViewer(service, { buildData: async (args) => { const data = await buildViewerData(args); snapshots.push(data); return data; } });
  t.after(() => viewer.close());
  await viewer.open({ modelHash: removed, accessScopes: scopes });
  assert.deepEqual([snapshots[0].branch.stageId, snapshots[0].branch.key, snapshots[0].branch.probability, snapshots[0].branch.premise], ['rain', 'yes', 0.3, null]);
  await viewer.open({ modelHash: trunk, accessScopes: scopes });
  assert.equal(snapshots[1].branch, undefined);
});

test('portable and model-only viewers label guessed odds and joints even when the joint equals the bound inner probability', async (t) => {
  const { service, trunk, forked } = await fixture(t);
  const original = await definitionOf(service, trunk);
  const rain = original.meaning_model.normalized_cuts.find((cut) => cut.id === 'rain');
  const snapshots = [];
  const viewer = createModelViewer(service, { buildData: async (args) => {
    const data = await buildViewerData(args); snapshots.push(data); return data;
  } });
  t.after(() => viewer.close());
  const render = (data) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', harness,
    new URL('../viewer/public/start.js', import.meta.url).href], {
    input: JSON.stringify({ url: 'http://127.0.0.1:1234/token/?view=structure', data }), encoding: 'utf8', timeout: 5_000,
  }));
  const views = async (branch) => {
    const portable = await buildViewerData({ history: await exportConstructionHistory(service, { graphHash: branch.graphHash, accessScopes: scopes }) });
    await viewer.open({ modelHash: branch.modelHash, accessScopes: scopes });
    return [portable, snapshots.at(-1)];
  };
  for (const data of await views(forked.branches[0])) {
    assert.equal(data.branch.windowStated, undefined);
    assert.equal(data.branch.jointIncludesGuess, undefined);
    const rendered = render(data);
    assert.deepEqual(rendered.errors, []);
    assert.match(rendered.branchBanner.text, /Probability 0\.3 as forecast\./u);
    assert.doesNotMatch(rendered.branchBanner.text, /guess/u);
  }
  for (const probability of [0.3, 1]) {
    const suffix = String(probability).replace('.', '-');
    const unbound = await revise(service, trunk, { reason: 'A forecast without a stated window, and a separate bound forecast.', upsert: {
      events: [event('forecast.strength', 'How strong the rain will be', 0, 0.1)],
      event_relations: [contains('knowing.forecast.strength', 'knowing', 'forecast.strength')],
      normalized_cuts: [
        { ...rain, answers: [{ key: 'yes', weight: probability }, { key: 'no', weight: 1 - probability }, { key: 'remainder', weight: 0 }],
          provenance: ['forecast: probabilities declared before the outcome'] },
        { ...rain, id: 'rain.strength', parent_event_id: 'forecast.strength', question: 'How strong will the rain be by year 10?',
          answers: [{ key: 'heavy', weight: 0.5 }, { key: 'light', weight: 0.4 }, { key: 'remainder', weight: 0.1 }] },
      ],
    } }, `guess.prepare.${suffix}`);
    const outer = (await forkStage(service, { requestId: `guess.fork.${suffix}`, stageId: `guess-${suffix}`, title: 'Assumed forecast window',
      trunkModelHash: unbound, kind: 'forecast', cutoff: 0, horizon: 10, forecast: { cutId: 'rain', window: { start: 0, end: 10 } },
      branches: [{ key: 'yes', premise: { boundary: 'It rains by year 10.', description: 'Assume rain in this guessed window.' } }],
      agentId: 'author', accessScopes: scopes })).branches[0];
    for (const data of await views(outer)) {
      assert.equal(data.branch.probability, probability);
      assert.equal(data.branch.windowStated, false);
      assert.equal(data.branch.jointIncludesGuess, undefined);
      const rendered = render(data);
      assert.deepEqual(rendered.errors, []);
      assert.equal(rendered.branchBanner.hidden, false);
      assert.ok(rendered.branchBanner.text.includes(`Probability ${probability} is a guess; the forecast window was not stated.`));
      assert.doesNotMatch(rendered.branchBanner.text, /as forecast/u);
    }
    const inner = (await forkStage(service, { requestId: `guess.inner.${suffix}`, stageId: `strength-${suffix}`, title: 'A bound inner forecast',
      trunkModelHash: outer.modelHash, kind: 'forecast', cutoff: 0, horizon: 10, forecast: { cutId: 'rain.strength', window: { start: 0, end: 10 } },
      branches: [{ key: 'heavy', premise: { boundary: 'The rain is heavy.', description: 'Assume heavy rain.' } }],
      agentId: 'author', accessScopes: scopes })).branches[0];
    for (const data of await views(inner)) {
      assert.deepEqual([data.branch.probability, data.branch.joint, data.branch.windowStated, data.branch.jointIncludesGuess],
        [0.5, probability * 0.5, undefined, true]);
      const rendered = render(data);
      assert.deepEqual(rendered.errors, []);
      assert.match(rendered.branchBanner.text, /Probability 0\.5 as forecast\./u);
      assert.ok(rendered.branchBanner.text.includes(`Joint probability ${probability * 0.5} with the branches it lies in includes a guess.`));
    }
  }
});

test('nested branch identity is resolved without its premise marker or a branch-graph inventory', async (t) => {
  const { service, forked } = await fixture(t);
  const outer = forked.branches[0];
  const nested = await forkStage(service, { requestId: 'nested.fork', stageId: 'severity', title: 'How much rain',
    trunkModelHash: outer.modelHash, kind: 'assumption', cutoff: 0, horizon: 10,
    branches: ['heavy', 'light'].map((key) => ({ key, premise: { boundary: `${key} rain`, description: `Assume ${key}.`, interval: { start: 0, end: 10 } } })),
    agentId: 'author', accessScopes: scopes });
  const inner = nested.branches[0];
  await assert.rejects(assertBranchSourceTransition(service, { kind: 'model', model_hash: inner.modelHash },
    { kind: 'model', model_hash: outer.modelHash }), /discard hypothetical branch status/u);
  const model = await definitionOf(service, inner.modelHash);
  const premise = model.meaning_model.events.find((item) => item.id === inner.premiseEventId);
  const edited = await revise(service, inner.modelHash, { reason: 'Revise the description.', upsert: {
    events: [{ ...premise, provenance: ['editor'] }],
  } }, 'nested.edit');
  const modelOnly = { inspectModel: (input) => service.inspectModel(input) };
  const ancestry = await branchesOf(modelOnly, edited);
  assert.deepEqual(ancestry.branches.map((branch) => [branch.stageId, branch.branch]), [['severity', 'heavy'], ['rain', 'yes']]);
  const data = await buildViewerData({ history: { schema: 'meaning-model-construction-history/v1', headGraphHash: null,
    models: [{ modelHash: edited, definition: await definitionOf(service, edited) }], revisions: [], branchAncestry: { modelHash: edited, ...ancestry } } });
  assert.deepEqual([data.branch.stageId, data.branch.key, data.branch.depth, data.branch.probability], ['severity', 'heavy', 2, null]);
});

test('long stored trunk and branch ancestry uses verified cached prefixes, and unresolved ancestry never passes a source guard', async () => {
  const hashes = Array.from({ length: 401 }, (_, index) => index.toString(16).padStart(64, '0'));
  let reads = 0;
  const models = new Map(hashes.map((hash, number) => [hash, { id: 'long-world', revision: { number,
    previous_model_hash: number ? hashes[number - 1] : null, provenance: number === 1
      ? [`${BRANCH_MARK} ${JSON.stringify({ stageId: 'long', branch: 'yes', kind: 'assumption', depth: 1, probability: null })}`] : [] } }]));
  const service = { inspectModel: async ({ modelHash }) => { reads += 1; return { summary: models.get(modelHash) }; } };
  assert.deepEqual((await branchesOf(service, hashes[400])).branches.map((branch) => branch.branch), ['yes']);
  assert.equal(reads, 401, 'a cold model-only store reads the full chain beyond the relative-walk bound');
  await branchesOf(service, hashes[350]);
  assert.equal(reads, 401, 'a verified prefix is reused');
  assert.equal((await branchesAlong(service, hashes[400])).truncated, true);
  const missing = { inspectModel: async () => ({ summary: null }) };
  await assert.rejects(assertBranchSourceTransition(missing, { kind: 'model', model_hash: hashes[0] },
    { kind: 'model', model_hash: hashes[1] }), /could not be checked completely/u);
  const trunkModels = new Map([...models].map(([hash, model]) => [hash, { ...model, revision: { ...model.revision, provenance: [] } }]));
  const trunkService = { inspectModel: async ({ modelHash }) => ({ summary: trunkModels.get(modelHash) }) };
  assert.deepEqual(await branchesOf(trunkService, hashes[400]), { branches: [], truncated: false });
  await assertBranchSourceTransition(trunkService, { kind: 'model', model_hash: hashes[0] }, { kind: 'model', model_hash: hashes[400] });
});

test('cold descendant source checks read only the suffix and still reject forks on it', async () => {
  const hashes = Array.from({ length: 401 }, (_, index) => index.toString(16).padStart(64, '0'));
  const source = (index) => ({ kind: 'model', model_hash: hashes[index] });
  const marker = (branch, stageId = 'rain') => `${BRANCH_MARK} ${JSON.stringify({ stageId, branch, kind: 'assumption', probability: null })}`;
  for (const existingBranch of [false, true]) {
    const visited = [];
    const service = { inspectModel: async ({ modelHash }) => {
      visited.push(modelHash);
      const number = hashes.indexOf(modelHash);
      return { summary: { id: 'cold-world', revision: { number, previous_model_hash: number ? hashes[number - 1] : null,
        provenance: existingBranch && number === 1 ? [marker('yes')] : [] } } };
    } };
    await assertBranchSourceTransition(service, source(398), source(400));
    assert.deepEqual(visited, [hashes[400], hashes[399]], 'both trunk and same-branch descendants need only the two new headers');
  }
  const visited = [];
  const forked = { inspectModel: async ({ modelHash }) => {
    visited.push(modelHash);
    const number = hashes.indexOf(modelHash);
    return { summary: { id: 'cold-world', revision: { number, previous_model_hash: number ? hashes[number - 1] : null,
      provenance: number === 399 ? [marker('heavy', 'severity')] : [] } } };
  } };
  await assert.rejects(assertBranchSourceTransition(forked, source(398), source(400)), /lies in branch heavy/u);
  assert.deepEqual(visited, [hashes[400], hashes[399]], 'a new fork is rejected without scanning the shared prefix');

  const incomplete = { inspectModel: async ({ modelHash }) => ({ summary: modelHash === hashes[400]
    ? { id: 'cold-world', revision: { number: 400, previous_model_hash: hashes[399], provenance: [] } } : null }) };
  await assert.rejects(assertBranchSourceTransition(incomplete, source(398), source(400)), /could not be checked completely/u);
  const cycle = { inspectModel: async ({ modelHash }) => ({ summary: { id: 'cycle', revision: { number: 400,
    previous_model_hash: modelHash === hashes[400] ? hashes[399] : hashes[400], provenance: [] } } }) };
  await assert.rejects(assertBranchSourceTransition(cycle, source(398), source(400)), /could not be checked completely/u);
});

test('complete, delta and convenience rebinds after a real restart do not inspect the shared model history', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'narrative-source-restart-'));
  const services = [];
  t.after(async () => {
    for (const service of services) await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const start = () => {
    const backend = new RustEngineProcess();
    backend.childEnvironment = { ...process.env, LIFE_SIM_STATE_FILE: join(directory, 'state.sqlite') };
    backend.arguments = ['--ndjson'];
    const service = new LifeSimulationService({ backend });
    services.push(service);
    return service;
  };
  const { service, trunk, graph } = await fixture(t, start());
  let previousModelHash = trunk;
  for (let index = 0; index < 24; index += 1) previousModelHash = await revise(service, previousModelHash,
    { reason: `Accepted history ${index}.`, upsert: { events: [{ ...event('world', 'Accepted history', 0, 10), description: `Revision ${index}.` }] } }, `restart.history.${index}`);
  const original = graph(previousModelHash, 'restart-graph');
  const stored = await service.registerNarrativeGraph({ requestId: 'restart.graph', narrativeGraph: original });
  const nextModelHash = await revise(service, previousModelHash, { reason: 'Latest accepted work.',
    upsert: { events: [{ ...event('world', 'Accepted history', 0, 10), description: 'Latest revision.' }] } }, 'restart.latest');
  await service.close();
  for (const route of ['complete', 'delta', 'rebind']) {
    const restarted = start();
    await restarted.initialize();
    const visited = [];
    const inspect = restarted.inspectModel.bind(restarted);
    restarted.inspectModel = async (input) => { visited.push(input.modelHash); return inspect(input); };
    const revision = { number: 1, previous_graph_hash: stored.graphHash, reason: `${route} after a restart.`, provenance };
    const source = { kind: 'model', model_hash: nextModelHash };
    const result = route === 'complete'
      ? await restarted.reviseNarrativeGraph({ requestId: 'restart.complete', previousGraphHash: stored.graphHash, narrativeGraph: { ...original, revision, source } })
      : route === 'delta'
        ? await restarted.reviseNarrativeGraphByDelta({ requestId: 'restart.delta', previousGraphHash: stored.graphHash, delta: { revision, source }, accessScopes: scopes })
        : await rebindNarrativeGraph(restarted, { requestId: 'restart.rebind', graphHash: stored.graphHash, modelHash: nextModelHash, accessScopes: scopes });
    assert.equal(result.stored, true);
    assert.ok(visited.length > 0);
    assert.ok(visited.every((hash) => hash === nextModelHash), `${route} must not read any of the 25 shared revisions`);
    if (route !== 'rebind') assert.deepEqual(visited, [nextModelHash]);
    await restarted.close();
  }
});

test('an ongoing model-only viewer can open a trunk beyond 255 revisions without reinspecting its known ancestry', async (t) => {
  const { service, trunk } = await fixture(t);
  let head = trunk;
  for (let revision = 0; revision < 270; revision += 1) head = await revise(service, head, { reason: `Accepted revision ${revision}.`,
    upsert: { events: [{ ...event('world', 'Accepted history', 0, 10), description: `Revision ${revision}.` }] } }, `long.${revision}`);
  let reads = 0;
  const inspect = service.inspectModel.bind(service);
  service.inspectModel = async (input) => { reads += 1; return inspect(input); };
  const snapshots = [];
  const viewer = createModelViewer(service, { buildData: async (args) => { const data = await buildViewerData(args); snapshots.push(data); return data; } });
  t.after(() => viewer.close());
  await viewer.open({ modelHash: head, accessScopes: scopes });
  assert.equal(snapshots[0].branch, undefined);
  assert.equal(reads, 1, 'the requested head is the only inspection; known ancestry is reused');
  const forked = await forkStage(service, { requestId: 'long.fork', stageId: 'long', title: 'A later stage', trunkModelHash: head,
    kind: 'assumption', cutoff: 5, horizon: 10, branches: ['one', 'two'].map((key) => ({ key,
      premise: { boundary: `Assume ${key}`, description: `Future ${key}.`, interval: { start: 5, end: 10 } } })), agentId: 'author', accessScopes: scopes });
  assert.equal(forked.branches.length, 2, 'a valid older trunk remains usable for a new stage');
});
