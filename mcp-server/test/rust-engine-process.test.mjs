import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EngineError, RustEngineProcess } from '../src/rust-engine-process.mjs';

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
