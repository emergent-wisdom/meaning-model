import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyJson } from './exact-json.mjs';

const COMMAND_SCHEMA = 'life-sim-rust-command/v1';
const RESPONSE_SCHEMA = 'life-sim-rust-response/v1';
// Execution ceilings depend on the operation. Heartbeats on stderr (LIFE_SIM_HEARTBEAT_MS) distinguish a silent
// engine from one that is still running; a finite ceiling also stops work that keeps beating but never finishes.
const DEFAULT_TIMEOUTS_MS = Object.freeze({ read: 10 * 60_000, write: 30 * 60_000, heavy: 60 * 60_000 });
// Opening a store validates and seals the revisions that have no seal yet: every revision, once, for a store written
// before seals. Later opens check those seals instead of validating every revision again.
const DEFAULT_STARTUP_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000;
// A call fails when an engine that has been beating falls silent this long.
const DEFAULT_HEARTBEAT_SILENCE_MS = 60_000;
const HEARTBEAT_SCHEMA = 'life-sim-rust-heartbeat/v1';
// Calls that compute rather than read or store: they get the longest ceiling.
const HEAVY_OPERATIONS = new Set([
  'validate_model',
  'compile_profiles',
  'roll_world',
  'reroll_candidate',
  'summarize_trajectory',
  'query_graph',
  'export_narrative_training',
  'audit_store',
]);
// A command or response carries at most a whole model (128 MiB) and its envelope.
const DEFAULT_MAX_COMMAND_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_PENDING_COMMAND_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_MAX_PENDING_CALLS = 32;
const MUTATING_OPERATIONS = new Set([
  'register_model',
  'revise_model',
  'create_world',
  'refine_genesis_world',
  'revise_world',
  'roll_world',
  'reroll_candidate',
  'reject_candidate',
  'commit_candidate',
  'register_narrative_graph',
  'revise_narrative_graph',
  'revise_narrative_graph_by_change',
  'apply_narrative_batch',
  'register_project_checkpoint',
  'audit_store',
]);
const REQUIRED_OPERATIONS = Object.freeze([
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
]);

export function operationKind(operation) {
  if (HEAVY_OPERATIONS.has(operation)) return 'heavy';
  if (MUTATING_OPERATIONS.has(operation)) return 'write';
  return 'read';
}

const engineFilename = process.platform === 'win32' ? 'life-sim-engine.exe' : 'life-sim-engine';
const releaseBinary = fileURLToPath(
  new URL(`../../rust-engine/target/release/${engineFilename}`, import.meta.url),
);
const debugBinary = fileURLToPath(
  new URL(`../../rust-engine/target/debug/${engineFilename}`, import.meta.url),
);

function executableAvailability(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveEngineBinary(environment = process.env, cwd = process.cwd()) {
  if (environment.LIFE_SIM_ENGINE_BIN) {
    return resolve(cwd, environment.LIFE_SIM_ENGINE_BIN);
  }
  if (executableAvailability(releaseBinary)) return releaseBinary;
  if (executableAvailability(debugBinary)) return debugBinary;
  return releaseBinary;
}

function engineUnavailableMessage(binaryPath) {
  return (
    `Life Simulation Rust machine is unavailable at ${binaryPath}. ` +
    'Run meaning-model-mcp --install-engine for a supported prebuilt release, ' +
    'or --build-engine (requires Cargo and native build tools), ' +
    'or set LIFE_SIM_ENGINE_BIN to a compatible executable. ' +
    'The MCP server will not fall back to JavaScript simulation.'
  );
}

function errorWithCause(message, cause) {
  return new Error(message, cause ? { cause } : undefined);
}

export class EngineError extends Error {
  constructor({ operation, requestId, code, message, cause = null }) {
    const indeterminate = ['persistence_uncertain', 'transport_indeterminate'].includes(code);
    const guidance = indeterminate
      ? 'Do not assume rollback or retry under a new idempotency key; reconcile the authoritative Rust model/world/candidate state, then replay only the original request.'
      : null;
    super(
      `Life Simulation Rust operation ${operation} failed (${code}): ${message}` +
      (guidance ? ` ${guidance}` : ''),
      cause ? { cause } : undefined,
    );
    this.name = 'EngineError';
    this.operation = operation;
    this.requestId = requestId;
    this.code = code;
    this.indeterminate = indeterminate;
    this.reconciliationGuidance = guidance;
  }
}

export class RustEngineProcess {
  constructor({
    binaryPath = resolveEngineBinary(),
    // One limit for every call, including its queue wait, as before kinds. Otherwise each kind has its own
    // execution budget (timeouts), starting after earlier requests have answered.
    timeoutMs = null,
    timeouts = {},
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatSilenceMs = DEFAULT_HEARTBEAT_SILENCE_MS,
    maxCommandBytes = DEFAULT_MAX_COMMAND_BYTES,
    maxPendingCommandBytes = DEFAULT_MAX_PENDING_COMMAND_BYTES,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
    maxPendingCalls = DEFAULT_MAX_PENDING_CALLS,
    testFixture = null,
    stateless = false,
  } = {}) {
    if (testFixture !== null && testFixture?.mode !== 'explicit-test-fixture') {
      throw new Error('Rust process fixtures require mode explicit-test-fixture.');
    }
    this.binaryPath = binaryPath;
    this.command = testFixture?.command ?? binaryPath;
    this.arguments = testFixture?.args ?? ['--ndjson'];
    // A stateless engine keeps nothing on disk: the state file setting is not passed on to it.
    const { LIFE_SIM_STATE_FILE: _stateFile, ...withoutStateFile } = process.env;
    const heartbeat = heartbeatIntervalMs > 0 ? { LIFE_SIM_HEARTBEAT_MS: String(heartbeatIntervalMs) } : {};
    this.childEnvironment = { ...(stateless ? withoutStateFile : process.env), ...heartbeat, ...(testFixture?.env ?? {}) };
    this.testFixture = testFixture !== null;
    this.timeoutMs = timeoutMs;
    this.timeouts = { ...DEFAULT_TIMEOUTS_MS, ...timeouts };
    this.startupTimeoutMs = startupTimeoutMs;
    this.heartbeatSilenceMs = heartbeatSilenceMs;
    // What the engine's last beat said; null until it beats, and an engine that never beats is held to the limits.
    this.heartbeat = null;
    this.heartbeatWatch = null;
    this.stderrPartial = '';
    this.maxCommandBytes = maxCommandBytes;
    this.maxPendingCommandBytes = maxPendingCommandBytes;
    this.maxResponseBytes = maxResponseBytes;
    this.maxStderrBytes = maxStderrBytes;
    this.maxPendingCalls = maxPendingCalls;
    this.child = null;
    this.pending = new Map();
    this.pendingCommandBytes = 0;
    this.writeQueue = [];
    this.writePromise = null;
    this.stdoutChunks = [];
    this.stdoutPendingBytes = 0;
    this.stderrBuffer = '';
    this.initializePromise = null;
    this.description = null;
    this.closed = false;
    this.failure = null;
  }

  static forTestFixture({ command, args = [], env = {}, ...limits }) {
    return new RustEngineProcess({
      ...limits,
      testFixture: {
        mode: 'explicit-test-fixture',
        command,
        args,
        env,
      },
    });
  }

  async initialize() {
    if (this.description) return this.description;
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('Life Simulation Rust process is closed.');
    if (!this.initializePromise) {
      this.initializePromise = this.#start().catch((cause) => {
        this.initializePromise = null;
        throw cause;
      });
    }
    return this.initializePromise;
  }

  async #start() {
    if (!this.testFixture && !executableAvailability(this.binaryPath)) {
      throw new Error(engineUnavailableMessage(this.binaryPath));
    }
    let child;
    try {
      child = spawn(this.command, this.arguments, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.childEnvironment,
      });
    } catch (cause) {
      throw errorWithCause(`Failed to start Life Simulation Rust machine: ${cause.message}`, cause);
    }
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#consumeStdout(chunk));
    child.stderr.on('data', (chunk) => this.#consumeStderr(chunk));
    // A write to an engine that has ended raises EPIPE on stdin. Without a listener Node ends the whole server with an
    // unhandled 'error' before the call is rejected with the reason the engine ended. The first failure stays the reason.
    child.stdin.on('error', (cause) => {
      this.#fail(errorWithCause(
        `Life Simulation Rust process stopped accepting commands (${cause.code ?? cause.message}).`,
        cause,
      ));
    });
    child.once('error', (cause) => {
      this.#fail(errorWithCause(`Life Simulation Rust process error: ${cause.message}`, cause));
    });
    child.once('exit', (code, signal) => {
      if (this.closed) return;
      const detail = signal ? `signal ${signal}` : `status ${code}`;
      const stderr = this.stderrBuffer.trim();
      this.#fail(new Error(
        `Life Simulation Rust process exited unexpectedly with ${detail}` +
        (stderr ? `: ${stderr}` : '.'),
      ));
    });

    const description = await this.#dispatch('describe', {}, this.startupTimeoutMs);
    if (
      description?.engine !== 'life-sim-engine' ||
      !Array.isArray(description?.operations) ||
      REQUIRED_OPERATIONS.some((operation) => !description.operations.includes(operation))
    ) {
      const cause = new Error(
        'Rust process describe response does not expose the required machine operations. ' +
        'Install or build the engine matching this MCP package, and check LIFE_SIM_ENGINE_BIN for an older executable.',
      );
      this.#fail(cause);
      throw cause;
    }
    this.description = Object.freeze(structuredClone(description));
    return this.description;
  }

  async call(operation, payload = {}) {
    if (typeof operation !== 'string' || !operation.trim()) {
      throw new Error('Rust engine operation must be a nonempty string.');
    }
    await this.initialize();
    return this.#dispatch(operation, payload);
  }

  /// How long a call of this operation may run.
  timeoutFor(operation) {
    return this.timeoutMs ?? this.timeouts[operationKind(operation)];
  }

  #dispatch(operation, payload, timeoutMs = this.timeoutFor(operation)) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.child || this.closed) {
      return Promise.reject(new Error('Life Simulation Rust process is not running.'));
    }
    if (this.pending.size >= this.maxPendingCalls) {
      return Promise.reject(new Error(
        `Life Simulation Rust process has reached its ${this.maxPendingCalls}-call queue limit.`,
      ));
    }
    const commandPayload = structuredClone(payload);
    for (const field of ['schema', 'request_id', 'operation']) {
      if (commandPayload != null && Object.hasOwn(commandPayload, field)) {
        return Promise.reject(new Error(
          `Rust command payload must not contain reserved field "${field}".`,
        ));
      }
    }
    const requestId = `mcp_${randomUUID()}`;
    const command = {
      schema: COMMAND_SCHEMA,
      request_id: requestId,
      operation,
      ...commandPayload,
    };
    let encoded;
    try {
      encoded = `${stringifyJson(command)}\n`;
    } catch (cause) {
      return Promise.reject(errorWithCause(`Could not encode Rust command: ${cause.message}`, cause));
    }
    const byteLength = Buffer.byteLength(encoded);
    if (byteLength > this.maxCommandBytes) {
      return Promise.reject(new Error(
        `Rust command is ${byteLength} bytes; limit is ${this.maxCommandBytes} bytes.`,
      ));
    }
    if (this.pendingCommandBytes + byteLength > this.maxPendingCommandBytes) {
      return Promise.reject(new Error(
        `Rust pending commands would use ${this.pendingCommandBytes + byteLength} bytes; ` +
        `aggregate limit is ${this.maxPendingCommandBytes} bytes.`,
      ));
    }

    return new Promise((resolveCall, rejectCall) => {
      const pending = {
        operation,
        resolve: resolveCall,
        reject: rejectCall,
        timer: null,
        timeoutMs,
        commandBytes: byteLength,
        writeState: 'queued',
        // Set when this call's budget starts, not while an earlier request is doing work.
        progressAtStart: null,
      };
      this.pending.set(requestId, pending);
      if (this.timeoutMs !== null) this.#startCallTimer(pending);
      else this.#startFirstCallTimer();
      this.pendingCommandBytes += byteLength;
      this.writeQueue.push({ requestId, operation, encoded });
      this.#scheduleWrites();
    });
  }

  // Rust executes requests serially. A queued read must not kill a healthy, longer-running computation ahead of it.
  // The first outstanding request always has a timer, so queue wait is still bounded by the finite budgets of the
  // requests ahead of it (at most maxPendingCalls), and the heartbeat watch still detects a stopped process.
  #startFirstCallTimer() {
    const first = this.pending.values().next().value;
    if (first) this.#startCallTimer(first);
  }

  #startCallTimer(pending) {
    if (pending.timer || this.failure || this.closed) return;
    pending.progressAtStart = this.heartbeat?.progress ?? null;
    const { operation, timeoutMs } = pending;
    pending.timer = setTimeout(() => {
      const cause = new Error(
        `Life Simulation Rust operation ${operation} timed out after ${timeoutMs} ms` +
        `${operation === 'describe' ? ' (opening the store)' : ` (a ${operationKind(operation)} call)`}. ` +
        this.#heartbeatReport(pending.progressAtStart) +
        (operation === 'describe' ? ' Opening validates and seals every revision that has no seal yet, once; later opens check seals.' : ''),
      );
      this.#fail(cause);
    }, timeoutMs);
    pending.timer.unref?.();
  }

  #scheduleWrites() {
    if (this.writePromise || this.failure || this.closed) return;
    this.writePromise = this.#drainWriteQueue()
      .catch((cause) => {
        this.#fail(errorWithCause(
          `Failed to write to Life Simulation Rust process: ${cause.message}`,
          cause,
        ));
      })
      .finally(() => {
        this.writePromise = null;
        if (this.writeQueue.length > 0 && !this.failure && !this.closed) {
          this.#scheduleWrites();
        }
      });
  }

  async #drainWriteQueue() {
    while (this.writeQueue.length > 0 && !this.failure && !this.closed) {
      const item = this.writeQueue.shift();
      if (!this.pending.has(item.requestId)) continue;
      await this.#writeCommand(item);
    }
  }

  #writeCommand({ requestId, operation, encoded }) {
    return new Promise((resolveWrite, rejectWrite) => {
      const pending = this.pending.get(requestId);
      if (!pending) {
        resolveWrite();
        return;
      }
      pending.writeState = 'writing';
      let callbackComplete = false;
      let drainComplete = true;
      let settled = false;
      const finish = () => {
        if (settled || !callbackComplete || !drainComplete) return;
        settled = true;
        resolveWrite();
      };
      const fail = (cause) => {
        if (settled) return;
        settled = true;
        rejectWrite(errorWithCause(
          `Failed to write ${operation} to Life Simulation Rust process: ${cause.message}`,
          cause,
        ));
      };
      let accepted;
      try {
        accepted = this.child.stdin.write(encoded, 'utf8', (cause) => {
          if (cause) {
            fail(cause);
            return;
          }
          pending.writeState = 'written';
          callbackComplete = true;
          finish();
        });
      } catch (cause) {
        fail(cause);
        return;
      }
      if (!accepted) {
        drainComplete = false;
        this.child.stdin.once('drain', () => {
          drainComplete = true;
          finish();
        });
      }
    });
  }

  // A response arrives in many chunks. They are kept as they come and joined once its line is complete, and only the
  // new chunk is searched for the line's end, so a large response costs time in proportion to its size; re-measuring
  // and re-searching the whole buffer for every chunk made it grow with the square of the size.
  #consumeStdout(chunk) {
    const text = String(chunk);
    let start = 0;
    let newlineIndex = text.indexOf('\n');
    while (newlineIndex !== -1) {
      if (!this.#keepStdout(text.slice(start, newlineIndex))) return;
      const line = this.stdoutChunks.join('');
      this.stdoutChunks = [];
      this.stdoutPendingBytes = 0;
      if (line.trim()) this.#consumeResponseLine(line);
      if (this.failure) return;
      start = newlineIndex + 1;
      newlineIndex = text.indexOf('\n', start);
    }
    if (start < text.length) this.#keepStdout(text.slice(start));
  }

  #keepStdout(piece) {
    this.stdoutPendingBytes += Buffer.byteLength(piece);
    if (this.stdoutPendingBytes > this.maxResponseBytes) {
      this.#fail(new Error(
        `Life Simulation Rust response exceeded ${this.maxResponseBytes} bytes.`,
      ));
      return false;
    }
    this.stdoutChunks.push(piece);
    return true;
  }

  #consumeResponseLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch (cause) {
      this.#fail(errorWithCause(
        `Life Simulation Rust process returned invalid NDJSON: ${cause.message}`,
        cause,
      ));
      return;
    }
    if (
      response?.schema !== RESPONSE_SCHEMA ||
      typeof response?.request_id !== 'string' ||
      typeof response?.ok !== 'boolean'
    ) {
      this.#fail(new Error('Life Simulation Rust process returned an invalid response envelope.'));
      return;
    }
    const pending = this.pending.get(response.request_id);
    if (!pending) {
      this.#fail(new Error('Life Simulation Rust process returned an unknown or duplicate request_id.'));
      return;
    }
    this.pending.delete(response.request_id);
    this.pendingCommandBytes -= pending.commandBytes;
    clearTimeout(pending.timer);
    this.#startFirstCallTimer();
    if (response.ok) {
      if (!Object.hasOwn(response, 'result')) {
        pending.reject(new Error(`Rust operation ${pending.operation} returned no result.`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    pending.reject(new EngineError({
      operation: pending.operation,
      requestId: response.request_id,
      code: response.error?.code ?? 'unknown',
      message: response.error?.message ?? 'no message',
    }));
  }

  // Heartbeat lines are read and left out of the stderr kept for error messages; every other line is kept.
  #consumeStderr(chunk) {
    const text = this.stderrPartial + String(chunk);
    const lines = text.split('\n');
    this.stderrPartial = lines.pop();
    if (Buffer.byteLength(this.stderrPartial) > this.maxStderrBytes) {
      lines.push(this.stderrPartial);
      this.stderrPartial = '';
    }
    for (const line of lines) {
      if (line.includes(`"${HEARTBEAT_SCHEMA}"`) && this.#consumeHeartbeat(line)) continue;
      this.#keepStderr(`${line}\n`);
    }
  }

  #keepStderr(text) {
    this.stderrBuffer += text;
    if (Buffer.byteLength(this.stderrBuffer) > this.maxStderrBytes) {
      const bytes = Buffer.from(this.stderrBuffer);
      this.stderrBuffer = bytes.subarray(bytes.length - this.maxStderrBytes).toString('utf8');
    }
  }

  #consumeHeartbeat(line) {
    let beat;
    try { beat = JSON.parse(line); } catch { return false; }
    if (beat?.schema !== HEARTBEAT_SCHEMA) return false;
    this.heartbeat = { at: Date.now(), sequence: beat.sequence, progress: beat.progress, busy: beat.busy ?? null };
    for (const pending of this.pending.values()) {
      if (pending.timer) pending.progressAtStart ??= beat.progress;
    }
    this.#watchHeartbeat();
    return true;
  }

  // Once the engine beats, a pending call fails when the beats stop: the engine has stopped (killed, frozen, or
  // swapped out entirely), not merely slowed down.
  #watchHeartbeat() {
    if (this.heartbeatWatch || !(this.heartbeatSilenceMs > 0)) return;
    this.heartbeatWatch = setInterval(() => {
      if (this.failure || this.closed) {
        clearInterval(this.heartbeatWatch);
        return;
      }
      if (!this.pending.size || !this.heartbeat) return;
      const silent = Date.now() - this.heartbeat.at;
      if (silent < this.heartbeatSilenceMs) return;
      const [first] = this.pending.values();
      this.#fail(new Error(
        `Life Simulation Rust process stopped answering: no heartbeat for ${silent} ms while ${first.operation} ran. ` +
        `Its last beat said ${this.#describeBeat()}. The process was stopped; restart the server to reopen the store.`,
      ));
    }, Math.min(5_000, Math.max(10, Math.floor(this.heartbeatSilenceMs / 4))));
    this.heartbeatWatch.unref?.();
  }

  #describeBeat() {
    const beat = this.heartbeat;
    if (!beat) return 'nothing';
    const busy = beat.busy ? `busy with ${beat.busy.operation} for ${beat.busy.elapsed_ms} ms` : 'idle';
    return `${busy}, progress ${beat.progress}`;
  }

  // Whether an engine that ran out of time was slow or had stopped.
  #heartbeatReport(progressAtStart) {
    if (!this.heartbeat) return 'The engine sent no heartbeat, so whether it was still working is not known.';
    const ago = Date.now() - this.heartbeat.at;
    const moved = progressAtStart === null ? null : this.heartbeat.progress - progressAtStart;
    return `Its last heartbeat came ${ago} ms ago (${this.#describeBeat()})` +
      (moved === null ? '.' : moved > 0
        ? `; its progress count moved by ${moved} during the call, so it was slow, not stopped.`
        : '; its progress count did not move during the call, so it may be stuck.');
  }

  #fail(cause) {
    if (this.failure || this.closed) return;
    this.failure = cause;
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      const rejection =
        MUTATING_OPERATIONS.has(pending.operation) && pending.writeState !== 'queued'
          ? new EngineError({
              operation: pending.operation,
              requestId,
              code: 'transport_indeterminate',
              message: cause.message,
              cause,
            })
          : cause;
      pending.reject(rejection);
    }
    this.pending.clear();
    this.pendingCommandBytes = 0;
    this.writeQueue.length = 0;
    if (this.heartbeatWatch) clearInterval(this.heartbeatWatch);
    if (this.child && !this.child.killed) this.child.kill('SIGKILL');
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatWatch) clearInterval(this.heartbeatWatch);
    const child = this.child;
    const closeCause = new Error('Life Simulation Rust process closed before responding.');
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      const rejection =
        MUTATING_OPERATIONS.has(pending.operation) && pending.writeState !== 'queued'
          ? new EngineError({
              operation: pending.operation,
              requestId,
              code: 'transport_indeterminate',
              message: closeCause.message,
              cause: closeCause,
            })
          : closeCause;
      pending.reject(rejection);
    }
    this.pending.clear();
    this.pendingCommandBytes = 0;
    this.writeQueue.length = 0;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
    child.stdin.end();
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 500);
    forceTimer.unref?.();
    await exited;
    clearTimeout(forceTimer);
  }

  status() {
    const persistenceConfigured =
      this.arguments.includes('--state-file') ||
      (typeof this.childEnvironment.LIFE_SIM_STATE_FILE === 'string' &&
        this.childEnvironment.LIFE_SIM_STATE_FILE.trim() !== '');
    return {
      backend: 'Life Simulation Rust machine',
      protocol: `${COMMAND_SCHEMA} over bounded NDJSON subprocess`,
      ready: this.description !== null && !this.failure && !this.closed,
      engineVersion: this.description?.engine_version ?? null,
      persistenceConfigured,
      persistenceMode: persistenceConfigured
        ? 'optional-single-writer-state-file'
        : 'process-memory',
      fixture: this.testFixture,
      heartbeat: this.heartbeat
        ? { lastBeatMsAgo: Date.now() - this.heartbeat.at, progress: this.heartbeat.progress, busy: this.heartbeat.busy }
        : null,
      limits: {
        timeoutMs: this.timeoutMs,
        timeouts: this.timeouts,
        heartbeatSilenceMs: this.heartbeatSilenceMs,
        startupTimeoutMs: this.startupTimeoutMs,
        maxCommandBytes: this.maxCommandBytes,
        maxPendingCommandBytes: this.maxPendingCommandBytes,
        pendingCommandBytes: this.pendingCommandBytes,
        maxResponseBytes: this.maxResponseBytes,
        maxPendingCalls: this.maxPendingCalls,
      },
    };
  }
}
