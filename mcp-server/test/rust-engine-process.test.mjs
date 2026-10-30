import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EngineError, RustEngineProcess, operationKind } from '../src/rust-engine-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'fixtures', 'process-fixture.mjs');

function fixture(options = {}) {
  return RustEngineProcess.forTestFixture({
    command: process.execPath,
    args: [fixturePath],
    ...options,
  });
}

test('bounded NDJSON backend starts, multiplexes calls, and closes cleanly', async (t) => {
  const backend = fixture();
  t.after(() => backend.close());
  const description = await backend.initialize();
  assert.equal(description.engine, 'life-sim-engine');
  assert.equal(description.operations.includes('compile_profiles'), true);
  assert.equal(description.operations.includes('refine_genesis_world'), true);
  assert.equal(backend.status().ready, true);
  assert.equal(backend.status().fixture, true);
  assert.equal(backend.status().limits.maxPendingCommandBytes, 512 * 1_024 * 1_024);
  assert.equal(backend.status().limits.pendingCommandBytes, 0);

  const [first, second, profiles] = await Promise.all([
    backend.call('compile_registry', { value: 'first' }),
    backend.call('roll', { value: 'second' }),
    backend.call('compile_profiles', { value: 'profiles' }),
  ]);
  assert.deepEqual(first, { operation: 'compile_registry', echoed: 'first' });
  assert.deepEqual(second, { operation: 'roll', echoed: 'second' });
  assert.deepEqual(profiles, { operation: 'compile_profiles', echoed: 'profiles' });
});

test('a large response arriving in many chunks is read whole, in time that grows with its size', async (t) => {
  const backend = fixture();
  t.after(() => backend.close());
  await backend.initialize();
  // Characters of two, three and four bytes that chunks will split.
  const unit = 'aé€😀b';
  // This process's own CPU time, in milliseconds: the reading happens here, and other work on a busy machine does not
  // count against it as it does against the clock.
  const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1_000; };
  const read = async (repeat) => {
    const started = cpu(), clock = performance.now();
    const response = await backend.call('roll', { value: unit, repeat });
    const elapsed = cpu() - started;
    wall = performance.now() - clock;
    assert.equal(response.echoed.length, unit.length * repeat);
    assert.equal(response.echoed, unit.repeat(repeat));
    return elapsed;
  };
  let wall = 0;
  await read(80_000);
  const small = Math.min(await read(625_000), await read(625_000));
  const large = await read(5_000_000);
  // Eight times the size (8 MB to 65 MB) takes about eight times as long when each chunk is read once, and about
  // seventy times when the whole buffer is re-read for every chunk (measured: 37 ms to 290 ms, against 99 ms to 7.1 s).
  // A ratio holds on a loaded machine, where a fixed bound did not: the full suite once read 32 MB in 2.2 s that alone
  // takes 0.25 s. It is a ratio of CPU time, since the clock ratio still passed 20 at a load average of 30 to 55. A
  // warm-up read comes first, and the faster of two small reads, so start-up costs do not shrink it.
  assert.ok(large / Math.max(small, 1) < 20, `65 MB in ${Math.round(large)} ms of CPU, 8 MB in ${Math.round(small)} ms`);
  assert.ok(wall < 30_000, `read in ${Math.round(wall)} ms`);
});

test('a response over the byte limit fails the backend with the limit named', async (t) => {
  const backend = fixture({ maxResponseBytes: 10_000 });
  t.after(() => backend.close());
  await backend.initialize();
  await assert.rejects(backend.call('roll', { value: 'x', repeat: 50_000 }), /response exceeded 10000 bytes/u);
});

test('typed command validation errors stay correlated and do not kill Rust', async (t) => {
  const backend = new RustEngineProcess();
  t.after(() => backend.close());
  await backend.initialize();
  await assert.rejects(
    backend.call('validate_model', { model: { unexpected: true } }),
    /validate_model failed \(invalid_json\)/,
  );
  const description = await backend.call('describe');
  assert.equal(description.engine, 'life-sim-engine');
  assert.equal(backend.status().ready, true);
});

test('payloads cannot override command envelope fields and rejection leaves the backend usable', async (t) => {
  const backend = fixture();
  t.after(() => backend.close());
  await backend.initialize();
  const originalWrite = backend.child.stdin.write.bind(backend.child.stdin);
  const observedWrites = [];
  backend.child.stdin.write = (chunk, encoding, callback) => {
    observedWrites.push(JSON.parse(chunk));
    return originalWrite(chunk, encoding, callback);
  };

  for (const [field, value] of [
    ['schema', 'unexpected-schema'],
    ['request_id', 'caller-controlled'],
    ['operation', 'create_world'],
    ['request_id', undefined],
  ]) {
    const writesBefore = observedWrites.length;
    await assert.rejects(
      backend.call('roll', { [field]: value }),
      { message: `Rust command payload must not contain reserved field "${field}".` },
    );
    assert.equal(observedWrites.length, writesBefore);
    assert.equal(backend.status().ready, true);
    assert.equal(backend.status().limits.pendingCommandBytes, 0);

    const result = await backend.call('roll', { value: 'after-rejection' });
    assert.deepEqual(result, { operation: 'roll', echoed: 'after-rejection' });
    assert.equal(observedWrites.length, writesBefore + 1);
    const command = observedWrites.at(-1);
    assert.equal(command.schema, 'life-sim-rust-command/v1');
    assert.match(command.request_id, /^mcp_/);
    assert.equal(command.operation, 'roll');
  }
});

test('Rust errors preserve code, operation, request id, and uncertain-persistence guidance', async (t) => {
  const backend = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'persistence_uncertain' } });
  t.after(() => backend.close());
  await backend.initialize();
  await assert.rejects(
    backend.call('create_world', { world_id: 'world' }),
    (cause) => {
      assert.ok(cause instanceof EngineError);
      assert.equal(cause.code, 'persistence_uncertain');
      assert.equal(cause.operation, 'create_world');
      assert.match(cause.requestId, /^mcp_/);
      assert.equal(cause.indeterminate, true);
      assert.match(cause.reconciliationGuidance, /Do not assume rollback/);
      return true;
    },
  );
});

test('transport loss after a mutating write is a typed indeterminate outcome', async () => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'hang_after_describe' },
    timeoutMs: 1_000,
  });
  await backend.initialize();
  backend.timeoutMs = 25;
  await assert.rejects(
    backend.call('create_world', { world_id: 'world' }),
    (cause) => {
      assert.ok(cause instanceof EngineError);
      assert.equal(cause.code, 'transport_indeterminate');
      assert.equal(cause.operation, 'create_world');
      assert.equal(cause.indeterminate, true);
      assert.match(cause.requestId, /^mcp_/);
      assert.match(cause.reconciliationGuidance, /Do not assume rollback/);
      return true;
    },
  );
  assert.equal(backend.status().ready, false);
  await backend.close();
});

test('transport loss during a project checkpoint write is indeterminate, as for every mutating operation', async () => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'hang_after_describe' },
    timeoutMs: 1_000,
  });
  await backend.initialize();
  backend.timeoutMs = 25;
  await assert.rejects(
    backend.call('register_project_checkpoint', { project_checkpoint: {} }),
    (cause) => {
      assert.ok(cause instanceof EngineError);
      assert.equal(cause.code, 'transport_indeterminate');
      assert.equal(cause.operation, 'register_project_checkpoint');
      assert.equal(cause.indeterminate, true);
      return true;
    },
  );
  await backend.close();
});

test('transport loss during store resealing reports an indeterminate write', async (t) => {
  const backend = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'hang_after_describe' }, timeoutMs: 1_000 });
  t.after(() => backend.close());
  await backend.initialize();
  backend.timeoutMs = 25;
  await assert.rejects(backend.call('audit_store', { store_audit: { reseal: true } }), (cause) => {
    assert.ok(cause instanceof EngineError);
    assert.equal(cause.code, 'transport_indeterminate');
    assert.equal(cause.operation, 'audit_store');
    assert.equal(cause.indeterminate, true);
    return true;
  });
});

test('transport loss after genesis refinement is also indeterminate', async () => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'hang_after_describe' },
    timeoutMs: 1_000,
  });
  await backend.initialize();
  backend.timeoutMs = 25;
  await assert.rejects(
    backend.call('refine_genesis_world', {
      world_id: 'world',
      model_hash: 'a'.repeat(64),
    }),
    (cause) => {
      assert.ok(cause instanceof EngineError);
      assert.equal(cause.code, 'transport_indeterminate');
      assert.equal(cause.operation, 'refine_genesis_world');
      assert.equal(cause.indeterminate, true);
      return true;
    },
  );
  await backend.close();
});

test('missing production binary fails explicitly without a JavaScript fallback', async () => {
  const backend = new RustEngineProcess({
    binaryPath: '/definitely/missing/life-sim-engine',
  });
  await assert.rejects(
    backend.initialize(),
    /Rust machine is unavailable.*will not fall back to JavaScript simulation/,
  );
});

test('commands are rejected before write when they exceed the configured bound', async (t) => {
  const backend = fixture({ maxCommandBytes: 400 });
  t.after(() => backend.close());
  await backend.initialize();
  await assert.rejects(
    backend.call('roll', { value: 'x'.repeat(1_000) }),
    /limit is 400 bytes/,
  );
});

test('aggregate pending command bytes are bounded independently of call count', async () => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'hang_after_describe' },
    maxCommandBytes: 900,
    maxPendingCommandBytes: 1_000,
    timeoutMs: 10_000,
  });
  await backend.initialize();
  const first = backend.call('roll', { value: 'x'.repeat(600) });
  await assert.rejects(
    backend.call('roll', { value: 'y'.repeat(600) }),
    /aggregate limit is 1000 bytes/,
  );
  assert.ok(backend.status().limits.pendingCommandBytes > 600);
  const firstRejection = assert.rejects(first, /closed before responding/);
  await backend.close();
  await firstRejection;
  assert.equal(backend.status().limits.pendingCommandBytes, 0);
});

test('writes are serialized and wait for drain after stdin backpressure', async (t) => {
  const backend = fixture();
  t.after(() => backend.close());
  await backend.initialize();
  const originalWrite = backend.child.stdin.write.bind(backend.child.stdin);
  const observedWrites = [];
  let delayFirst = true;
  backend.child.stdin.write = (chunk, encoding, callback) => {
    observedWrites.push(chunk);
    if (!delayFirst) return originalWrite(chunk, encoding, callback);
    delayFirst = false;
    setTimeout(() => {
      originalWrite(chunk, encoding, callback);
      backend.child.stdin.emit('drain');
    }, 20);
    return false;
  };

  const first = backend.call('roll', { value: 'first-backpressured' });
  const second = backend.call('roll', { value: 'second-queued' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(observedWrites.length, 1);
  const results = await Promise.all([first, second]);
  assert.equal(observedWrites.length, 2);
  assert.deepEqual(results.map(({ echoed }) => echoed), [
    'first-backpressured',
    'second-queued',
  ]);
});

test('malformed protocol output fails startup and tears down the child', async () => {
  const backend = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'malformed' } });
  await assert.rejects(backend.initialize(), /invalid NDJSON/);
  assert.equal(backend.status().ready, false);
  await backend.close();
});

test('operation timeout rejects outstanding work and tears down the child', async () => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'hang' },
    timeoutMs: 25,
    startupTimeoutMs: 25,
  });
  await assert.rejects(backend.initialize(), /timed out after 25 ms/);
  assert.equal(backend.status().ready, false);
  await backend.close();
});

test('each kind of call has its own time limit, and one given limit still applies to all', async () => {
  assert.equal(operationKind('get_model'), 'read');
  assert.equal(operationKind('model_lineage'), 'read');
  assert.equal(operationKind('revise_model'), 'write');
  assert.equal(operationKind('apply_narrative_batch'), 'write');
  assert.equal(operationKind('validate_model'), 'heavy');
  assert.equal(operationKind('audit_store'), 'heavy');
  const kinds = fixture({ timeouts: { read: 111, write: 222, heavy: 333 } });
  assert.deepEqual(['get_model', 'revise_model', 'validate_model'].map((operation) => kinds.timeoutFor(operation)), [111, 222, 333]);
  const one = fixture({ timeoutMs: 25 });
  assert.deepEqual(['get_model', 'revise_model', 'validate_model'].map((operation) => one.timeoutFor(operation)), [25, 25, 25]);
  // The defaults leave a slow engine minutes, not the 30 seconds that killed one under memory pressure.
  const defaults = fixture();
  assert.ok(defaults.timeoutFor('validate_model') >= 30 * 60_000);
  assert.ok(defaults.timeoutFor('get_model') >= 5 * 60_000);
});

test('a queued read gets its own time budget after a longer computation answers', async (t) => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating_serial' },
    timeouts: { read: 100, write: 1_000, heavy: 2_000 },
    heartbeatSilenceMs: 2_000,
  });
  t.after(() => backend.close());
  await backend.initialize();
  const results = await Promise.all([
    backend.call('validate_model', { delay_ms: 300 }),
    backend.call('get_model', { delay_ms: 1 }),
  ]);
  assert.deepEqual(results.map((result) => result.operation), ['validate_model', 'get_model']);
  assert.equal(backend.status().ready, true);
  assert.equal(backend.pending.size, 0);
});

test('a queued call remains bounded by the execution limit of the request ahead of it', async (t) => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating_serial' },
    timeouts: { read: 50, write: 1_000, heavy: 200 },
    heartbeatSilenceMs: 2_000,
  });
  t.after(() => backend.close());
  await backend.initialize();
  const results = await Promise.allSettled([
    backend.call('validate_model', { never_finish: true }),
    backend.call('get_model', {}),
  ]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /validate_model timed out after 200 ms/u);
  }
  assert.equal(backend.status().ready, false);
});

test('an explicitly supplied single timeout still includes time spent waiting in the queue', async (t) => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating_serial' },
    timeoutMs: 2_000,
    heartbeatSilenceMs: 2_000,
  });
  t.after(() => backend.close());
  await backend.initialize();
  const first = backend.call('validate_model', { delay_ms: 300 });
  // call awaits initialization before dispatch, so let the first call capture its explicit budget.
  await new Promise((resolve) => setImmediate(resolve));
  backend.timeoutMs = 100;
  const results = await Promise.allSettled([first, backend.call('get_model', { delay_ms: 1 })]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /get_model timed out after 100 ms/u);
  }
});

test('a write to an engine that stopped reading fails with the reason, not an unhandled EPIPE', async () => {
  const backend = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'stop_reading_after_describe' } });
  await backend.initialize();
  backend.timeoutMs = 100;
  // Larger than a pipe holds, so the write is still going on when the call runs out of time and the engine is killed.
  await assert.rejects(
    backend.call('validate_model', { value: 'x'.repeat(4 * 1024 * 1024) }),
    /timed out after 100 ms \(a heavy call\)/u,
  );
  // Closing before the killed engine is reaped can raise EPIPE on stdin. The listener keeps the first failure.
  await backend.close();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(backend.failure.message, /timed out after 100 ms/u);
});

test('an engine that stops beating fails its call within the silence limit, however long the call may run', async () => {
  const backend = fixture({
    env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating' },
    timeoutMs: 60_000,
    heartbeatSilenceMs: 300,
  });
  await backend.initialize();
  // Silence counts only for an engine known to beat.
  while (!backend.heartbeat) await new Promise((resolve) => setTimeout(resolve, 10));
  const started = Date.now();
  await assert.rejects(backend.call('freeze', {}), /stopped answering: no heartbeat for \d+ ms while freeze ran.*busy with freeze/u);
  assert.ok(Date.now() - started < 5_000, 'the silence was noticed long before the call\'s limit');
  await backend.close();
});

test('a slow engine that keeps beating is reported as slow, a stuck one as stuck', async () => {
  const slow = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating' }, heartbeatSilenceMs: 5_000 });
  await slow.initialize();
  // Slower than the old fixed limit of these tests, and it finishes: beats keep it alive.
  assert.deepEqual(await slow.call('get_model', { delay_ms: 150 }), { operation: 'get_model' });
  slow.timeoutMs = 200;
  await assert.rejects(slow.call('never_finish', {}), /timed out after 200 ms.*progress count moved by \d+ during the call, so it was slow, not stopped/u);
  await slow.close();

  const stuck = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating_stuck' }, heartbeatSilenceMs: 5_000 });
  await stuck.initialize();
  stuck.timeoutMs = 200;
  await assert.rejects(stuck.call('never_finish', {}), /did not move during the call, so it may be stuck/u);
  await stuck.close();
});

test('heartbeat lines are read, and left out of the stderr kept for error messages', async (t) => {
  const backend = fixture({ env: { LIFE_SIM_PROCESS_FIXTURE_MODE: 'beating' } });
  t.after(() => backend.close());
  await backend.initialize();
  await backend.call('get_model', { delay_ms: 80 });
  assert.equal(backend.status().heartbeat !== null, true);
  assert.equal(typeof backend.status().heartbeat.progress, 'number');
  assert.match(backend.stderrBuffer, /an ordinary diagnostic line/u);
  assert.doesNotMatch(backend.stderrBuffer, /heartbeat/u);
  // The engine is asked to beat.
  assert.equal(backend.childEnvironment.LIFE_SIM_HEARTBEAT_MS, '2000');
});
