// Process-local estimate receipts prevent nondeterministic provider retries from changing
// an accepted proposal. These are not durable graph state; restart requires a new explicit
// proposal. Entries and retained/pending bytes are bounded, and request IDs never evict.
import { createHash, randomUUID } from 'node:crypto';

const stores = new WeakMap();
const fallbackOwner = {};
const MAX_ENTRIES = 1_024;
const MAX_BYTES = 128 * 1_024 * 1_024;
const MAX_VALUE_BYTES = 4 * 1_024 * 1_024;
const RESERVATION = MAX_VALUE_BYTES * 2;
const canonical = (value) => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
export const estimatorPayloadHash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const encode = (value) => {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_VALUE_BYTES) throw new Error('Estimator receipt exceeds its 4 MiB retention limit.');
  return json;
};
function storeFor(owner) {
  owner ??= fallbackOwner;
  let store = stores.get(owner);
  if (!store) { store = { requests: new Map(), proposals: new Map(), bytes: 0 }; stores.set(owner, store); }
  return store;
}
function reserve(store, bytes) {
  if (store.bytes + bytes > MAX_BYTES) throw new Error('Estimator receipt memory quota reached; no new operation was started.');
  store.bytes += bytes;
}

export function retainEstimatorProposal(owner, operation, binding, value) {
  const store = storeFor(owner);
  const json = encode(value);
  const bytes = Buffer.byteLength(json) + 512;
  if (store.proposals.size >= MAX_ENTRIES) throw new Error('Estimator proposal quota reached.');
  reserve(store, bytes);
  const proposalId = `estimate.${randomUUID()}`;
  store.proposals.set(proposalId, { operation, binding: estimatorPayloadHash(binding), json });
  return proposalId;
}
export function readEstimatorProposal(owner, operation, binding, proposalId) {
  const entry = storeFor(owner).proposals.get(proposalId);
  if (!entry) throw new Error('Unknown estimator proposalId in this server session; supply the reviewed distributions explicitly or create a new proposal.');
  if (entry.operation !== operation || entry.binding !== estimatorPayloadHash(binding)) throw new Error('proposalId is bound to different modeling inputs; request a new proposal for changed inputs.');
  return JSON.parse(entry.json);
}
// Apply-only clients need not retransmit the authoring scaffold. The operation
// namespace and the caller's expected proposal hash still guard exact adoption.
export function readEstimatorProposalById(owner, operation, proposalId) {
  const entry = storeFor(owner).proposals.get(proposalId);
  if (!entry) throw new Error('Unknown estimator proposalId in this server session; create a new proposal after a restart.');
  if (entry.operation !== operation) throw new Error('proposalId belongs to a different estimator operation.');
  return JSON.parse(entry.json);
}

// produce receives a bounded checkpoint store. Completed steps can be resumed after a
// partial multi-operation result; concurrent identical requests share one execution.
export async function runEstimatorRequest(owner, operation, requestId, payload, produce) {
  const store = storeFor(owner);
  const key = `${operation}:${requestId}`;
  const binding = estimatorPayloadHash(payload);
  let entry = store.requests.get(key);
  if (entry && entry.binding !== binding) throw new Error(`requestId ${requestId} is already bound to a different ${operation} payload.`);
  if (!entry) {
    if (store.requests.size >= MAX_ENTRIES) throw new Error('Estimator request receipt quota reached.');
    reserve(store, RESERVATION);
    entry = { binding, checkpoints: {}, result: null, promise: null, reservation: RESERVATION };
    store.requests.set(key, entry);
  }
  if (entry.result !== null) return JSON.parse(entry.result);
  if (entry.promise) return structuredClone(await entry.promise);
  const checkpoint = {
    get(key) { return entry.checkpoints[key] === undefined ? undefined : JSON.parse(entry.checkpoints[key]); },
    set(key, value) {
      const json = encode(value);
      encode({ ...entry.checkpoints, [key]: json });
      entry.checkpoints[key] = json;
      return value;
    },
  };
  entry.promise = (async () => {
    const result = await produce(checkpoint);
    let json;
    try { json = encode(result); }
    catch (error) { error.indeterminate = true; error.receiptRetained = true; throw error; }
    if (!result?.partial) {
      entry.result = json;
      entry.checkpoints = {};
      const retained = Buffer.byteLength(json) + 512;
      store.bytes -= entry.reservation - retained;
      entry.reservation = retained;
    }
    return JSON.parse(json);
  })();
  try { return structuredClone(await entry.promise); }
  catch (error) {
    if (error?.indeterminate) entry.result = encode({ error: error.message, indeterminate: true, receiptRetained: true, requestId });
    else if (!Object.keys(entry.checkpoints).length) { store.requests.delete(key); store.bytes -= entry.reservation; }
    throw error;
  }
  finally { entry.promise = null; }
}
