import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RustEngineProcess } from '../../mcp-server/src/rust-engine-process.mjs';

const provenance = ['Authored progressive-construction example; not empirical data'];
const event = (id, start, end) => ({
  id, boundary: id, interval: { start, end }, process_ids: [], provenance,
  description: `The ${id} process, opened only to the detail needed for this example.`,
});
const cut = (id, parent, hopeful, threatened) => ({
  id, parent_event_id: parent, question: 'How is this outlook divided?', unit: 'outlook comparison',
  answers: [
    { key: 'hopeful', weight: hopeful }, { key: 'threatened', weight: threatened },
    { key: 'remainder', weight: 0.10 },
  ], provenance,
});

function coarseModel() {
  return {
    schema: 'life-sim-rust-model/v1', id: 'progressive-authoring', time_unit: 'day',
    revision: { number: 0, reason: 'Start with a coarse ten-day account', provenance },
    processes: [{
      id: 'cash', unit: 'GBP', value_type: { kind: 'scalar', bounds: { minimum: 0, maximum: 100 } },
      initial_value: { kind: 'scalar', value: 20 }, update_mode: 'static', provenance,
      support: ['trial cash ledger'], access_scopes: [],
    }],
    meaning_model: {
      schema: 'life-sim-rust-meaning-model/v1', events: [event('trial', 0, 10)],
      context_roots: [{ event_id: 'trial', kind: 'inner', provenance }],
      normalized_cuts: [cut('outlook', 'trial', 0.58, 0.32)],
    },
  };
}

function nextModel(previous, hash, reason) {
  const model = structuredClone(previous);
  model.revision = {
    number: previous.revision.number + 1, previous_model_hash: hash, reason, provenance,
  };
  return model;
}

function addPeriod(model, id, start, end, hopeful, threatened) {
  const mm = model.meaning_model;
  mm.events.push(event(id, start, end));
  (mm.event_relations ??= []).push({
    id: `trial.${id}`, source_event_id: 'trial', target_event_id: id,
    kind: 'contains', provenance,
  });
  mm.normalized_cuts.push(cut(`outlook.${id}`, id, hopeful, threatened));
}

function contract(model, children, coverage) {
  model.meaning_model.temporal_cut_recompositions = [{
    parent_cut_id: 'outlook', coverage,
    children: children.map(id => ({ cut_id: `outlook.${id}`, projection: { kind: 'identity' } })),
    provenance,
  }];
}

// The injected transport makes the example usable as a regression test too.
export async function runExample(engine) {
  const register = async model => (await engine.call(
    model.revision.number ? 'revise_model' : 'register_model', { model },
  )).summary.model_hash;
  const advance = async index => {
    const result = await engine.call('roll_world', {
      world_id: 'example', query: {
        schema: 'life-sim-rust-model-query/v1', delta_time: 1, step_size: 1,
        seed: 'progressive-authoring', roll_index: index, path: { mode: 'full' },
        requested_observables: ['cash'],
      },
    });
    return (await engine.call('commit_candidate', {
      candidate_hash: result.candidate.candidate_hash,
      view: { requested_observables: ['cash'], access_scopes: [], include_path: false },
    })).world_head;
  };
  const revise = async (head, hash, mode, reason, state = {}) => engine.call('revise_world', {
    world_id: 'example', model_hash: hash,
    world_revision: {
      expected_world_hash: head.world_hash, mode, state_values: state, reason, provenance,
    },
    view: { requested_observables: ['cash'], access_scopes: [], include_path: false },
  });

  const coarse = coarseModel();
  const coarseHash = await register(coarse);
  await engine.call('create_world', { world_id: 'example', model_hash: coarseHash });
  const before = await advance(0); // Accepted history already exists.

  const impossible = nextModel(coarse, coarseHash, 'Try an incompatible first period');
  addPeriod(impossible, 'preparation', 0, 8, 0.80, 0.10);
  contract(impossible, ['preparation'], 'partial');
  let rejection;
  await assert.rejects(register(impossible), error => {
    rejection = error.message;
    return /infeasible residual/.test(rejection);
  });

  const partial = nextModel(coarse, coarseHash, 'Open eight days without changing the whole');
  addPeriod(partial, 'preparation', 0, 8, 0.60, 0.30);
  contract(partial, ['preparation'], 'partial');
  const partialHash = await register(partial);
  const opened = await revise(before, partialHash, 'refine', 'Accept compatible partial detail');
  assert.equal(opened.world_head.time, before.time);

  const complete = nextModel(partial, partialHash, 'Open the two remaining days');
  addPeriod(complete, 'comparison', 8, 10, 0.50, 0.40);
  contract(complete, ['preparation', 'comparison'], 'complete');
  const completeHash = await register(complete);
  const completed = await revise(opened.world_head, completeHash, 'refine', 'Complete the partition');
  // .8*.60 + .2*.50 = .58; .8*.30 + .2*.40 = .32.

  const revised = nextModel(complete, completeHash, 'Revise the account after reconsidering its ending');
  const cuts = revised.meaning_model.normalized_cuts;
  cuts[0] = cut('outlook', 'trial', 0.56, 0.34);
  cuts[2] = cut('outlook.comparison', 'comparison', 0.40, 0.50);
  const revisedHash = await register(revised);
  const changed = await revise(completed.world_head, revisedHash, 'revise',
    'The comparison is less hopeful; update its parent rather than hide the mismatch',
    { cash: { kind: 'scalar', value: 18 } });
  const after = await advance(1);
  assert.equal(after.model_hash, revisedHash);
  assert.equal(after.time, before.time + 1);
  assert.equal(after.state.cash.value, 18);
  const receipt = await engine.call('get_world_revision', {
    world_revision_hash: changed.world_revision_hash,
  });
  assert.equal(receipt.world_revision.source_head.world_hash, completed.world_head.world_hash);
  const old = await engine.call('get_model', { model_hash: coarseHash });
  assert.equal(old.model.meaning_model.normalized_cuts[0].answers.find(a => a.key === 'hopeful').weight, 0.58);
  return {
    rejectedDetail: rejection,
    acceptedSteps: ['coarse world', 'accepted day', 'partial refinement', 'complete refinement', 'explicit revision', 'next accepted day'],
    coarseModelHash: coarseHash, finalModelHash: revisedHash,
    revisionReceipt: changed.world_revision_hash, finalTime: after.time,
    parentBefore: [0.58, 0.32, 0.10], parentAfter: [0.56, 0.34, 0.10],
    oldModelPreserved: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.LIFE_SIM_STATE_FILE) {
    throw new Error('Unset LIFE_SIM_STATE_FILE: this demonstration runs in an isolated, in-memory session.');
  }
  const engine = new RustEngineProcess();
  try { console.log(JSON.stringify(await runExample(engine), null, 2)); }
  finally { await engine.close(); }
}
