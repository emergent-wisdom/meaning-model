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
  'revise_world',
  'get_world_revision',
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
  'revise_narrative_graph_by_change',
  'apply_narrative_batch',
  'query_narrative_graph',
  'render_narrative_graph',
  'export_narrative_training',
  'model_lineage',
  'model_heads',
  'store_status',
];

// Heartbeats as the engine writes them on stderr when LIFE_SIM_HEARTBEAT_MS is set. The beating modes write their own,
// every 20 ms, so a test can stop them (frozen) or keep them while the work stands still (stuck).
let progress = 0;
let busy = null;
let beating = mode.startsWith('beating');
let sequence = 0;
if (beating) {
  setInterval(() => {
    if (!beating) return;
    sequence += 1;
    if (busy && mode !== 'beating_stuck') progress += 1;
    process.stderr.write(`${JSON.stringify({ busy, progress, schema: 'life-sim-rust-heartbeat/v1', sequence })}\n`);
  }, 20);
}

function respond(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function describeResponse(command) {
  return {
    schema: 'life-sim-rust-response/v1',
    request_id: command.request_id,
    ok: true,
    result: { engine: 'life-sim-engine', engine_version: 'test-fixture', operations },
  };
}

// Match the native engine's serial execution, while the existing beating fixture deliberately allows concurrent
// responses to exercise correlation. Work queued here does not start until the previous command has answered.
const serialQueue = [];
let serialRunning = false;
function runSerialQueue() {
  if (serialRunning || !serialQueue.length) return;
  const command = serialQueue.shift();
  serialRunning = true;
  busy = { operation: command.operation, request_id: command.request_id, elapsed_ms: 0 };
  if (command.never_finish) return;
  setTimeout(() => {
    respond({ schema: 'life-sim-rust-response/v1', request_id: command.request_id, ok: true, result: { operation: command.operation } });
    serialRunning = false;
    busy = null;
    runSerialQueue();
  }, command.delay_ms ?? 0);
}

// An engine that answers describe and then no longer reads its stdin, as one swapped out or stopped: a large write to
// it blocks part way.
if (mode === 'stop_reading_after_describe') {
  let buffered = '';
  const onData = (chunk) => {
    buffered += chunk;
    const newline = buffered.indexOf('\n');
    if (newline === -1) return;
    process.stdin.off('data', onData);
    process.stdin.pause();
    respond(describeResponse(JSON.parse(buffered.slice(0, newline))));
    setInterval(() => {}, 1_000);
  };
  process.stdin.on('data', onData);
}

const input = mode === 'stop_reading_after_describe' ? null : createInterface({ input: process.stdin, crlfDelay: Infinity });
input?.on('line', (line) => {
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
  if (mode === 'beating_serial') {
    serialQueue.push(command);
    runSerialQueue();
    return;
  }
  if (beating) {
    busy = { operation: command.operation, request_id: command.request_id, elapsed_ms: 0 };
    process.stderr.write('an ordinary diagnostic line\n');
    if (command.operation === 'freeze') {
      sequence += 1;
      process.stderr.write(`${JSON.stringify({ busy, progress, schema: 'life-sim-rust-heartbeat/v1', sequence })}\n`);
      beating = false;
      return;
    }
    if (command.operation === 'never_finish') return;
    setTimeout(() => {
      busy = null;
      respond({ schema: 'life-sim-rust-response/v1', request_id: command.request_id, ok: true, result: { operation: command.operation } });
    }, command.delay_ms ?? 0);
    return;
  }
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
    // repeat: a response much larger than its command, to test reading large responses.
    result: { operation: command.operation, echoed: typeof command.repeat === 'number' ? String(command.value).repeat(command.repeat) : command.value ?? null },
  });
});
