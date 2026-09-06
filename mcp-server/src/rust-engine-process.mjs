import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMAND_SCHEMA = 'life-sim-rust-command/v1';
const RESPONSE_SCHEMA = 'life-sim-rust-response/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_COMMAND_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_PENDING_COMMAND_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
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
  'apply_narrative_batch',
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
  'apply_narrative_batch',
  'query_narrative_graph',
  'render_narrative_graph',
  'export_narrative_training',
]);

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
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxCommandBytes = DEFAULT_MAX_COMMAND_BYTES,
    maxPendingCommandBytes = DEFAULT_MAX_PENDING_COMMAND_BYTES,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
    maxPendingCalls = DEFAULT_MAX_PENDING_CALLS,
    testFixture = null,
  } = {}) {
    if (testFixture !== null && testFixture?.mode !== 'explicit-test-fixture') {
      throw new Error('Rust process fixtures require mode explicit-test-fixture.');
    }
    this.binaryPath = binaryPath;
    this.command = testFixture?.command ?? binaryPath;
    this.arguments = testFixture?.args ?? ['--ndjson'];
    this.childEnvironment = testFixture?.env
      ? { ...process.env, ...testFixture.env }
      : process.env;
    this.testFixture = testFixture !== null;
    this.timeoutMs = timeoutMs;
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
    this.stdoutBuffer = '';
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

    const description = await this.#dispatch('describe', {});
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

  #dispatch(operation, payload) {
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
      encoded = `${JSON.stringify(command)}\n`;
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
      const timer = setTimeout(() => {
        const cause = new Error(
          `Life Simulation Rust operation ${operation} timed out after ${this.timeoutMs} ms.`,
        );
        this.#fail(cause);
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        operation,
        resolve: resolveCall,
        reject: rejectCall,
        timer,
        commandBytes: byteLength,
        writeState: 'queued',
      });
      this.pendingCommandBytes += byteLength;
      this.writeQueue.push({ requestId, operation, encoded });
      this.#scheduleWrites();
    });
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

  #consumeStdout(chunk) {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > this.maxResponseBytes) {
      this.#fail(new Error(
        `Life Simulation Rust response exceeded ${this.maxResponseBytes} bytes.`,
      ));
      return;
    }
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim()) this.#consumeResponseLine(line);
      if (this.failure) return;
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
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

  #consumeStderr(chunk) {
    this.stderrBuffer += chunk;
    if (Buffer.byteLength(this.stderrBuffer) > this.maxStderrBytes) {
      const bytes = Buffer.from(this.stderrBuffer);
      this.stderrBuffer = bytes.subarray(bytes.length - this.maxStderrBytes).toString('utf8');
    }
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
    if (this.child && !this.child.killed) this.child.kill('SIGKILL');
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
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
      limits: {
        timeoutMs: this.timeoutMs,
        maxCommandBytes: this.maxCommandBytes,
        maxPendingCommandBytes: this.maxPendingCommandBytes,
        pendingCommandBytes: this.pendingCommandBytes,
        maxResponseBytes: this.maxResponseBytes,
        maxPendingCalls: this.maxPendingCalls,
      },
    };
  }
}

export const rustProcessDefaults = Object.freeze({
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxCommandBytes: DEFAULT_MAX_COMMAND_BYTES,
  maxPendingCommandBytes: DEFAULT_MAX_PENDING_COMMAND_BYTES,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
  maxPendingCalls: DEFAULT_MAX_PENDING_CALLS,
});
