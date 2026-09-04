import { createInterface } from 'node:readline';

const mode = process.env.LIFE_SIM_PROCESS_FIXTURE_MODE ?? 'normal';
const operations = [
  'describe',
  'compile_registry',
  'roll',
  'compile_profiles',
  'validate_model',
  'register_model',
  'revise_model',
  'get_model',
  'create_world',
  'get_world',
  'refine_genesis_world',
  'query_graph',
  'query_view',
  'roll_world',
  'inspect_candidate',
  'summarize_trajectory',
  'reroll_candidate',
  'reject_candidate',
  'commit_candidate',
  'register_narrative_graph',
  'revise_narrative_graph',
  'apply_narrative_batch',
  'query_narrative_graph',
  'render_narrative_graph',
  'export_narrative_training',
];

function respond(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  const command = JSON.parse(line);
  if (mode === 'hang') return;
  if (mode === 'malformed') {
    process.stdout.write('not-json\n');
    return;
  }
  if (mode === 'exit') {
    process.exit(7);
  }
  if (command.operation === 'describe') {
    respond({
      schema: 'life-sim-rust-response/v1',
      request_id: command.request_id,
      ok: true,
      result: {
        engine: 'life-sim-engine',
        engine_version: 'test-fixture',
        operations,
      },
    });
    return;
  }
  if (mode === 'hang_after_describe') return;
  if (mode === 'persistence_uncertain') {
    respond({
      schema: 'life-sim-rust-response/v1',
      request_id: command.request_id,
      ok: false,
      error: {
        code: 'persistence_uncertain',
        message: 'directory synchronization failed after atomic replacement',
      },
    });
    return;
  }
  respond({
    schema: 'life-sim-rust-response/v1',
    request_id: command.request_id,
    ok: true,
    result: { operation: command.operation, echoed: command.value ?? null },
  });
});
