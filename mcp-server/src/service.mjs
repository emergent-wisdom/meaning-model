import { createHash, randomUUID } from 'node:crypto';

import {
  forcingTargets,
  hasNorthHarborPreset,
  loadNorthHarborModel,
} from './north-harbor-presets.mjs';
import { RustEngineProcess } from './rust-engine-process.mjs';
import {
  createWriterContract,
  evaluateWriterPlan,
  MAX_WRITER_FIELDS,
} from './writer-negotiator.mjs';
import {
  MAX_ROUTE_CANDIDATES,
  MAX_ROUTE_TERMS,
  routeCandidates,
} from './candidate-router.mjs';
import { diagnoseStoryRevision } from './story-revision-diagnostic.mjs';
import {
  buildObservationMaterializationPlan,
  canonicalEstimationJson,
  estimationDispositions,
  estimationIntents,
  estimationOperations,
  estimationOutputModes,
  estimationReviewVerdicts,
  MAX_ESTIMATION_CONTEXT_LENGTH,
  MAX_ESTIMATION_COORDINATES,
  MAX_ESTIMATION_PROPOSALS,
  MAX_ESTIMATION_PROPOSAL_BYTES,
  MAX_ESTIMATION_REASON_LENGTH,
  MAX_ESTIMATION_REQUESTS,
  MAX_ESTIMATION_REQUEST_BYTES,
  MAX_ESTIMATION_REVIEWS,
  MAX_ESTIMATION_REVIEW_BYTES,
  MAX_ESTIMATION_STORAGE_BYTES,
  MAX_PROVISIONAL_CLAIMS,
  MAX_SEMANTIC_CHANGES,
  validateEstimationRequestInput,
  validateEstimationResponseInput,
  validateEstimationReviewInput,
} from './estimation-exchange.mjs';

const SERVICE_SCHEMA = 'life-sim-mcp-service/v2';
const MODEL_SCHEMA = 'life-sim-rust-model/v1';
const PROFILE_COMPILATION_SCHEMA = 'life-sim-rust-profile-compilation/v1';
const QUERY_SCHEMA = 'life-sim-rust-model-query/v1';
const TRAJECTORY_SUMMARY_QUERY_SCHEMA = 'life-sim-rust-trajectory-summary-query/v1';
const MAX_WORLDS = 16;
const MAX_MODELS = 32;
const MAX_CANDIDATES_PER_WORLD = 128;
const MAX_TRAJECTORY_FIELDS = 100;
const MAX_TRAJECTORY_SAMPLES = 256;
const MAX_VIEW_FIELDS = 1_000;
const MAX_VIEW_ACCESS_SCOPES = 64;
const MAX_QUERY_DELTA_TIME = 30;
const MAX_QUERY_STEP_SIZE = 30;
const MAX_QUERY_PROCESS_REFERENCES = 2_048;
const MAX_QUERY_INTERVENTIONS = 1_000;
const MAX_QUERY_OBSERVATIONS = 1_000;
const MAX_QUERY_STRING_LENGTH = 1_024;
const MAX_QUERY_NESTING_DEPTH = 128;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_HANDLE_LENGTH = 256;
const MAX_PREFIXES = 20;
const MAX_PREFIX_LENGTH = 256;
const MAX_ANNOTATION_ISSUES = 100;
const MAX_ANNOTATION_FIELD_ID_LENGTH = 1_024;
const MAX_ANNOTATION_CODE_LENGTH = 128;
const MAX_ANNOTATION_EXPLANATION_LENGTH = 2_000;
const MAX_ANNOTATION_BYTES = 64 * 1_024;
const MAX_WRITER_BRIEF_LENGTH = 10_000;
const MAX_WRITER_EXPLANATION_LENGTH = 2_000;
const MAX_WRITER_CONTRACT_INPUT_BYTES = 96 * 1_024;
const MAX_WRITER_PLAN_INPUT_BYTES = 96 * 1_024;
const MAX_GRAPH_NEIGHBORHOOD_DEPTH = 16;
const MAX_NARRATIVE_GRAPH_BYTES = 8 * 1024 * 1024;
const MAX_NARRATIVE_ROOTS = 1_024;
const MAX_NARRATIVE_NODES = 50_000;
const MAX_NARRATIVE_EDGES = 200_000;
const MAX_MODEL_BYTES = 8 * 1024 * 1024;
const MAX_MODEL_PROCESSES = 10_000;
const MAX_MODEL_LAWS = 50_000;
const MAX_MODEL_EDGES = 50_000;
const MAX_MODEL_CLAIMS = 10_000;
const MAX_MODEL_MEANING_RECORDS = 50_000;
const MAX_PROFILE_SPECS = 256;
const MAX_MEANING_QUERY_IDS = 256;
const MAX_MEANING_QUERY_ITEMS = 250;
const MAX_MEANING_QUERY_OFFSET = MAX_MODEL_MEANING_RECORDS;
const MAX_MEANING_QUERY_DEFINITION_BYTES = 512 * 1_024;
const MAX_RECEIPTS_PER_SCOPE = 4_096;
const MAX_RECEIPT_BYTES_GLOBAL = 64 * 1_024 * 1_024;
const MAX_MODEL_RECEIPT_RESULT_BYTES = 4 * 1_024 * 1_024;
const MAX_STANDARD_RECEIPT_RESULT_BYTES = 256 * 1_024;
const MAX_EVALUATIONS_PER_WORLD = 1_024;
const MAX_WRITER_CONTRACTS_PER_WORLD = 128;
const MAX_WRITER_PLANS_PER_WORLD = 512;
const ESTIMATION_SCHEMA = 'life-sim-mcp-estimation/v1';

export const meaningModelCollections = Object.freeze([
  'concepts',
  'abstract_relations',
  'abstract_cuts',
  'referents',
  'encapsulation_cuts',
  'events',
  'event_relations',
  'event_referent_bindings',
  'physical_cuts',
  'realizations',
  'normalized_cuts',
  'context_roots',
  'temporal_cut_recompositions',
]);

function meaningRecordId(collection, record) {
  if (collection === 'context_roots') return record.event_id;
  if (collection === 'temporal_cut_recompositions') return record.parent_cut_id;
  return record.id;
}

function compactCandidate(record, candidateId) {
  const { candidate, status } = record;
  return {
    candidateId,
    candidateHash: candidate.candidate_hash,
    parentHash: candidate.parent_world_hash,
    parentVersion: candidate.expected_parent_version,
    rollIndex: candidate.roll_index,
    startTime: candidate.start_time,
    endTime: candidate.end_time,
    fieldCount: Object.keys(candidate.successor_state).length,
    canonical: status === 'committed',
    authority: status === 'committed' ? 'accepted-lineage' : `${status}-candidate`,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureBoundedNonemptyString(value, label, maximum = MAX_QUERY_STRING_LENGTH) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximum
  ) {
    throw new Error(
      `${label} must be a nonempty string of at most ${maximum} characters.`,
    );
  }
}

function ensureBoundedStringArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} entries.`);
  }
  for (const [index, item] of value.entries()) {
    ensureBoundedNonemptyString(item, `${label}[${index}]`);
  }
}

function validateNarrativeGraphInput(graph) {
  if (!isRecord(graph)) throw new Error('narrativeGraph must be an object.');
  if (graph.schema !== 'life-sim-rust-narrative-graph/v1') {
    throw new Error('narrativeGraph.schema must be life-sim-rust-narrative-graph/v1.');
  }
  ensureBoundedNonemptyString(graph.id, 'narrativeGraph.id');
  if (!isRecord(graph.revision) || !Number.isSafeInteger(graph.revision.number)) {
    throw new Error('narrativeGraph.revision.number must be a safe integer.');
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length > MAX_NARRATIVE_NODES) {
    throw new Error(`narrativeGraph.nodes must contain at most ${MAX_NARRATIVE_NODES} nodes.`);
  }
  if (!Array.isArray(graph.edges) || graph.edges.length > MAX_NARRATIVE_EDGES) {
    throw new Error(`narrativeGraph.edges must contain at most ${MAX_NARRATIVE_EDGES} edges.`);
  }
  if (!Array.isArray(graph.roots) || graph.roots.length > MAX_NARRATIVE_ROOTS) {
    throw new Error(`narrativeGraph.roots must contain at most ${MAX_NARRATIVE_ROOTS} roots.`);
  }
  const bytes = Buffer.byteLength(canonicalJson(graph));
  if (bytes > MAX_NARRATIVE_GRAPH_BYTES) {
    throw new Error(
      `narrativeGraph uses ${bytes} bytes; limit is ${MAX_NARRATIVE_GRAPH_BYTES}.`,
    );
  }
}

function validateNarrativeBatchInput(batch) {
  if (!isRecord(batch)) throw new Error('narrativeBatch must be an object.');
  if (batch.schema !== 'life-sim-rust-narrative-batch/v1') {
    throw new Error('narrativeBatch.schema must be life-sim-rust-narrative-batch/v1.');
  }
  ensureHash(batch.previous_graph_hash, 'narrativeBatch.previous_graph_hash');
  ensureBoundedNonemptyString(batch.reason, 'narrativeBatch.reason');
  ensureBoundedStringArray(batch.provenance, 'narrativeBatch.provenance', MAX_NARRATIVE_NODES);
  const addRoots = batch.add_roots ?? [];
  const addNodes = batch.add_nodes ?? [];
  const addEdges = batch.add_edges ?? [];
  if (!Array.isArray(addRoots) || addRoots.length > MAX_NARRATIVE_ROOTS) {
    throw new Error(
      `narrativeBatch.add_roots must contain at most ${MAX_NARRATIVE_ROOTS} roots.`,
    );
  }
  for (const [index, root] of addRoots.entries()) {
    ensureBoundedNonemptyString(root, `narrativeBatch.add_roots[${index}]`);
  }
  if (!Array.isArray(addNodes) || addNodes.length > MAX_NARRATIVE_NODES) {
    throw new Error(
      `narrativeBatch.add_nodes must contain at most ${MAX_NARRATIVE_NODES} nodes.`,
    );
  }
  if (!Array.isArray(addEdges) || addEdges.length > MAX_NARRATIVE_EDGES) {
    throw new Error(
      `narrativeBatch.add_edges must contain at most ${MAX_NARRATIVE_EDGES} edges.`,
    );
  }
  if (
    addRoots.length === 0 &&
    addNodes.length === 0 &&
    addEdges.length === 0
  ) {
    throw new Error('narrativeBatch must add at least one root, node, or edge.');
  }
  const bytes = Buffer.byteLength(canonicalJson(batch));
  if (bytes > MAX_NARRATIVE_GRAPH_BYTES) {
    throw new Error(
      `narrativeBatch uses ${bytes} bytes; limit is ${MAX_NARRATIVE_GRAPH_BYTES}.`,
    );
  }
}

function validateQueryStrings(value) {
  const pending = [{ value, depth: 0, label: 'query' }];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.depth > MAX_QUERY_NESTING_DEPTH) {
      throw new Error(`query nesting depth exceeds ${MAX_QUERY_NESTING_DEPTH}.`);
    }
    if (typeof current.value === 'string') {
      ensureBoundedNonemptyString(current.value, current.label);
      continue;
    }
    if (current.value === null || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) throw new Error('query must not contain cycles.');
    seen.add(current.value);
    const entries = Array.isArray(current.value)
      ? current.value.entries()
      : Object.entries(current.value);
    for (const [key, child] of entries) {
      pending.push({
        value: child,
        depth: current.depth + 1,
        label: `${current.label}.${key}`,
      });
    }
  }
}

function validatePositiveBoundedNumber(value, label, maximum) {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be positive, finite, and at most ${maximum}.`);
  }
}

function validateTransitionQuery(query) {
  if (!isRecord(query)) throw new Error('query must be an object.');
  validateQueryStrings(query);
  if (query.schema !== QUERY_SCHEMA) {
    throw new Error(`query.schema must be ${QUERY_SCHEMA}.`);
  }
  validatePositiveBoundedNumber(query.delta_time, 'query.delta_time', MAX_QUERY_DELTA_TIME);
  validatePositiveBoundedNumber(query.step_size, 'query.step_size', MAX_QUERY_STEP_SIZE);
  if (query.seed !== undefined) ensureBoundedNonemptyString(query.seed, 'query.seed');
  if (
    query.roll_index !== undefined &&
    (!Number.isSafeInteger(query.roll_index) || query.roll_index < 0)
  ) {
    throw new Error('query.roll_index must be a nonnegative safe integer.');
  }
  if (query.direction !== undefined && !['forward', 'backward'].includes(query.direction)) {
    throw new Error('query.direction must be forward or backward.');
  }
  if (
    query.precedence !== undefined &&
    !['coarse', 'fine', 'balanced'].includes(query.precedence)
  ) {
    throw new Error('query.precedence must be coarse, fine, or balanced.');
  }
  for (const key of ['temporal_resolution', 'semantic_resolution']) {
    if (query[key] !== undefined) ensureBoundedNonemptyString(query[key], `query.${key}`);
  }
  for (const [key, maximum] of [
    ['requested_observables', MAX_QUERY_PROCESS_REFERENCES],
    ['selected_support', MAX_QUERY_PROCESS_REFERENCES],
    ['access_scopes', MAX_VIEW_ACCESS_SCOPES],
  ]) {
    if (query[key] !== undefined) ensureBoundedStringArray(query[key], `query.${key}`, maximum);
  }
  if (query.interventions !== undefined) {
    if (
      !Array.isArray(query.interventions) ||
      query.interventions.length > MAX_QUERY_INTERVENTIONS
    ) {
      throw new Error(
        `query.interventions must be an array with at most ${MAX_QUERY_INTERVENTIONS} entries.`,
      );
    }
    for (const [index, intervention] of query.interventions.entries()) {
      if (!isRecord(intervention)) {
        throw new Error(`query.interventions[${index}] must be an object.`);
      }
      ensureBoundedNonemptyString(intervention.id, `query.interventions[${index}].id`);
      if (
        !Number.isFinite(intervention.offset) ||
        intervention.offset < 0 ||
        intervention.offset > query.delta_time
      ) {
        throw new Error(
          `query.interventions[${index}].offset must lie within the simulated interval.`,
        );
      }
      if (!isRecord(intervention.effect)) {
        throw new Error(`query.interventions[${index}].effect must be an object.`);
      }
    }
  }
  if (
    query.observations !== undefined &&
    (!Array.isArray(query.observations) || query.observations.length > MAX_QUERY_OBSERVATIONS)
  ) {
    throw new Error(
      `query.observations must be an array with at most ${MAX_QUERY_OBSERVATIONS} entries.`,
    );
  }
  if (query.path !== undefined) {
    if (!isRecord(query.path)) throw new Error('query.path must be an object.');
    if (!['endpoint', 'full', 'decimated'].includes(query.path.mode)) {
      throw new Error('query.path.mode must be endpoint, full, or decimated.');
    }
    const allowedPathKeys = query.path.mode === 'decimated'
      ? new Set(['mode', 'every'])
      : new Set(['mode']);
    if (Object.keys(query.path).some((key) => !allowedPathKeys.has(key))) {
      throw new Error(`query.path contains fields invalid for ${query.path.mode} mode.`);
    }
    if (
      query.path.mode === 'decimated' &&
      (!Number.isSafeInteger(query.path.every) || query.path.every < 1)
    ) {
      throw new Error('query.path.every must be a positive safe integer for decimated paths.');
    }
    if (query.path.mode !== 'decimated' && query.path.every !== undefined) {
      throw new Error('query.path.every is valid only for decimated paths.');
    }
  }
}

function stats(values) {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  const at = (probability) => sorted[Math.round((sorted.length - 1) * probability)];
  return {
    count: values.length,
    mean: Number(mean.toFixed(6)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(6)),
    min: Number(sorted[0].toFixed(6)),
    q10: Number(at(0.1).toFixed(6)),
    median: Number(at(0.5).toFixed(6)),
    q90: Number(at(0.9).toFixed(6)),
    max: Number(sorted.at(-1).toFixed(6)),
  };
}

function matchesPrefixes(id, prefixes) {
  return prefixes.length === 0 || prefixes.some((prefix) => id.startsWith(prefix));
}

function ensureRequestId(requestId) {
  ensureBoundedNonemptyString(requestId, 'requestId', MAX_REQUEST_ID_LENGTH);
}

function ensureHandle(value, label) {
  ensureBoundedNonemptyString(value, label, MAX_HANDLE_LENGTH);
}

function ensureHash(value, label) {
  if (typeof value !== 'string' || value.length !== 64) {
    throw new Error(`${label} must be a 64-character hash.`);
  }
}

function validatePrefixes(prefixes, label = 'fieldPrefixes') {
  if (!Array.isArray(prefixes) || prefixes.length > MAX_PREFIXES) {
    throw new Error(`${label} must be an array with at most ${MAX_PREFIXES} entries.`);
  }
  for (const [index, prefix] of prefixes.entries()) {
    ensureBoundedNonemptyString(prefix, `${label}[${index}]`, MAX_PREFIX_LENGTH);
  }
}

function validateAnnotation({ verdict, issues }) {
  if (!['plausible', 'implausible', 'uncertain'].includes(verdict)) {
    throw new Error('verdict must be plausible, implausible, or uncertain.');
  }
  if (!Array.isArray(issues) || issues.length > MAX_ANNOTATION_ISSUES) {
    throw new Error(`issues must be an array with at most ${MAX_ANNOTATION_ISSUES} entries.`);
  }
  for (const [index, issue] of issues.entries()) {
    if (!isRecord(issue)) throw new Error(`issues[${index}] must be an object.`);
    if (issue.fieldId !== undefined) {
      ensureBoundedNonemptyString(
        issue.fieldId,
        `issues[${index}].fieldId`,
        MAX_ANNOTATION_FIELD_ID_LENGTH,
      );
    }
    ensureBoundedNonemptyString(
      issue.code,
      `issues[${index}].code`,
      MAX_ANNOTATION_CODE_LENGTH,
    );
    ensureBoundedNonemptyString(
      issue.explanation,
      `issues[${index}].explanation`,
      MAX_ANNOTATION_EXPLANATION_LENGTH,
    );
  }
  let encoded;
  try {
    encoded = JSON.stringify(issues);
  } catch (cause) {
    throw new Error(`issues must be JSON-serializable: ${cause.message}`);
  }
  const bytes = Buffer.byteLength(encoded);
  if (bytes > MAX_ANNOTATION_BYTES) {
    throw new Error(`issues use ${bytes} bytes; annotation limit is ${MAX_ANNOTATION_BYTES}.`);
  }
}

function validateAggregateJsonBytes(value, label, maximum) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (cause) {
    throw new Error(`${label} must be JSON-serializable: ${cause.message}`);
  }
  const bytes = Buffer.byteLength(encoded);
  if (bytes > maximum) {
    throw new Error(`${label} uses ${bytes} UTF-8 bytes; limit is ${maximum}.`);
  }
}

function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return JSON.stringify(Number.isFinite(value) ? value : null);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('Request payload must not contain cycles.');
    ancestors.add(value);
    const encoded = `[${value.map((item) => (
      item === undefined ? 'null' : canonicalJson(item, ancestors)
    )).join(',')}]`;
    ancestors.delete(value);
    return encoded;
  }
  if (typeof value === 'object') {
    if (ancestors.has(value)) throw new Error('Request payload must not contain cycles.');
    ancestors.add(value);
    const encoded = `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`)
      .join(',')}}`;
    ancestors.delete(value);
    return encoded;
  }
  throw new Error(`Request payload contains unsupported ${typeof value} value.`);
}

function canonicalPayloadHash(canonicalPayload) {
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

function receiptResultAllowance(operation) {
  return ['register-model', 'revise-model'].includes(operation)
    ? MAX_MODEL_RECEIPT_RESULT_BYTES
    : MAX_STANDARD_RECEIPT_RESULT_BYTES;
}

function compactModelMutationSummary(summary) {
  const meaningSummary = summary?.meaning_model;
  return {
    model_hash: summary?.model_hash ?? null,
    revision_number: summary?.revision?.number ?? null,
    process_count: summary?.process_count ?? null,
    decomposition_edge_count: summary?.decomposition_edge_count ?? null,
    dependency_edge_count: summary?.dependency_edge_count ?? null,
    law_count: summary?.law_count ?? null,
    law_roles: structuredClone(summary?.law_roles ?? {}),
    ...(meaningSummary === undefined
      ? {}
      : {
          meaning_model: isRecord(meaningSummary)
            ? {
                schema: meaningSummary.schema ?? null,
                concept_count: meaningSummary.concept_count ?? null,
                abstract_relation_count: meaningSummary.abstract_relation_count ?? null,
                abstract_cut_count: meaningSummary.abstract_cut_count ?? null,
                referent_count: meaningSummary.referent_count ?? null,
                encapsulation_cut_count: meaningSummary.encapsulation_cut_count ?? null,
                event_count: meaningSummary.event_count ?? null,
                event_relation_count: meaningSummary.event_relation_count ?? null,
                event_referent_binding_count:
                  meaningSummary.event_referent_binding_count ?? null,
                physical_cut_count: meaningSummary.physical_cut_count ?? null,
                realization_count: meaningSummary.realization_count ?? null,
                normalized_cut_count: meaningSummary.normalized_cut_count ?? null,
                context_root_count: meaningSummary.context_root_count ?? null,
                temporal_cut_recomposition_count:
                  meaningSummary.temporal_cut_recomposition_count ?? null,
              }
            : null,
        }),
  };
}

class ReceiptRetentionError extends Error {
  constructor({ operation, resultBytes, allowance }) {
    super(
      `${operation} completed but its ${resultBytes}-byte receipt exceeded the ` +
      `${allowance}-byte retention allowance. The idempotency receipt is retained; ` +
      'do not retry with a new request ID, and reconcile through read-only inspection.',
    );
    this.name = 'ReceiptRetentionError';
    this.code = 'receipt_retention_overflow_after_mutation';
    this.operation = operation;
    this.resultBytes = resultBytes;
    this.allowance = allowance;
    this.indeterminate = true;
    this.reconciliationGuidance =
      'Do not retry with a new request ID; inspect authoritative state and replay only the original idempotency request.';
  }
}

function scalar(value) {
  return value?.kind === 'scalar' && Number.isFinite(value.value) ? value.value : null;
}

function displayValue(value) {
  const scalarValue = scalar(value);
  return scalarValue === null ? structuredClone(value) : scalarValue;
}

function candidateId(candidateHash) {
  return `candidate_${candidateHash}`;
}

function modelHashFromResult(result) {
  const modelHash = result?.summary?.model_hash ?? result?.model_hash;
  if (typeof modelHash !== 'string' || !modelHash) {
    throw new Error('Rust model response did not contain model_hash.');
  }
  return modelHash;
}

function processIdsFromModelResult(result) {
  const processIds = result?.summary?.process_ids ?? result?.model?.processes?.map(({ id }) => id);
  if (!Array.isArray(processIds) || processIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Rust model response did not contain a valid process-id inventory.');
  }
  return [...processIds].sort();
}

function meaningModelBlock(model) {
  const block = model?.meaning_model;
  if (block === undefined || block === null) return null;
  if (!isRecord(block)) throw new Error('model.meaning_model must be an object when present.');
  return block;
}

function meaningCollectionRecords(block, collection, label = 'model.meaning_model') {
  const records = block?.[collection] ?? [];
  if (!Array.isArray(records)) {
    throw new Error(`${label}.${collection} must be an array when present.`);
  }
  return records;
}

function validateMeaningQuery({ collections, ids, offset, limit }) {
  if (
    !Array.isArray(collections) ||
    collections.length < 1 ||
    collections.length > meaningModelCollections.length
  ) {
    throw new Error(
      `collections must contain between 1 and ${meaningModelCollections.length} entries.`,
    );
  }
  const allowedCollections = new Set(meaningModelCollections);
  const seenCollections = new Set();
  for (const [index, collection] of collections.entries()) {
    if (!allowedCollections.has(collection)) {
      throw new Error(`collections[${index}] is not a Meaning Model collection.`);
    }
    if (seenCollections.has(collection)) {
      throw new Error(`collections must not repeat ${collection}.`);
    }
    seenCollections.add(collection);
  }
  ensureBoundedStringArray(ids, 'ids', MAX_MEANING_QUERY_IDS);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_MEANING_QUERY_OFFSET
  ) {
    throw new Error(
      `offset must be a nonnegative safe integer at most ${MAX_MEANING_QUERY_OFFSET}.`,
    );
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MEANING_QUERY_ITEMS) {
    throw new Error(
      `limit must be a positive safe integer at most ${MAX_MEANING_QUERY_ITEMS}.`,
    );
  }
}

function validateModelBounds(model) {
  let encoded;
  try {
    encoded = JSON.stringify(model);
  } catch (cause) {
    throw new Error(`Model is not JSON-serializable: ${cause.message}`);
  }
  const byteLength = Buffer.byteLength(encoded);
  if (byteLength > MAX_MODEL_BYTES) {
    throw new Error(`Model is ${byteLength} bytes; MCP model limit is ${MAX_MODEL_BYTES} bytes.`);
  }
  if (model?.schema !== MODEL_SCHEMA) {
    throw new Error(`model.schema must be ${MODEL_SCHEMA}.`);
  }
  const counts = [
    ['processes', model.processes, MAX_MODEL_PROCESSES],
    ['laws', model.laws ?? [], MAX_MODEL_LAWS],
    [
      'decomposition and dependency edges',
      [...(model.decomposition ?? []), ...(model.dependencies ?? [])],
      MAX_MODEL_EDGES,
    ],
    ['initial claims', model.initial_claims ?? [], MAX_MODEL_CLAIMS],
  ];
  for (const [label, records, maximum] of counts) {
    if (!Array.isArray(records) || records.length > maximum) {
      throw new Error(`Model ${label} must be an array with at most ${maximum} entries.`);
    }
  }
  const meaningModel = meaningModelBlock(model);
  if (meaningModel !== null) {
    let meaningRecordCount = 0;
    for (const collection of meaningModelCollections) {
      meaningRecordCount += meaningCollectionRecords(meaningModel, collection).length;
      if (meaningRecordCount > MAX_MODEL_MEANING_RECORDS) {
        throw new Error(
          `Model Meaning Model layer must contain at most ` +
          `${MAX_MODEL_MEANING_RECORDS} records across all collections.`,
        );
      }
    }
  }
}

function validateProfileCompilationRequest(profileRequest) {
  if (!isRecord(profileRequest)) {
    throw new Error('profileRequest must be an object.');
  }
  validateAggregateJsonBytes(profileRequest, 'profileRequest', MAX_MODEL_BYTES);
  if (profileRequest.schema !== PROFILE_COMPILATION_SCHEMA) {
    throw new Error(`profileRequest.schema must be ${PROFILE_COMPILATION_SCHEMA}.`);
  }
  if (!isRecord(profileRequest.model)) {
    throw new Error('profileRequest.model must be an object.');
  }
  if (
    !Array.isArray(profileRequest.profiles) ||
    profileRequest.profiles.length < 1 ||
    profileRequest.profiles.length > MAX_PROFILE_SPECS
  ) {
    throw new Error(
      `profileRequest.profiles must contain between 1 and ${MAX_PROFILE_SPECS} entries.`,
    );
  }
}

function expressionConstant(value) {
  return { op: 'constant', value };
}

function forcingInterventions(head, deltaTime, enabled) {
  if (!enabled) return [];
  const endTargets = forcingTargets(head.time + deltaTime);
  return Object.keys(endTargets).sort().flatMap((target) => {
    if (!(target in head.state)) return [];
    return [{
      id: `continuous-control:${target}`,
      offset: deltaTime,
      effect: {
        target,
        mode: 'set',
        value: expressionConstant(endTargets[target]),
      },
    }];
  });
}

function startState(candidate) {
  const first = candidate.path?.samples?.[0];
  if (!first || first.time !== candidate.start_time) return null;
  return first.state;
}

function endpointDifferences(first, second) {
  const firstIds = Object.keys(first.successor_state).sort();
  const secondIds = Object.keys(second.successor_state).sort();
  if (JSON.stringify(firstIds) !== JSON.stringify(secondIds)) {
    throw new Error('Candidates cover different models.');
  }
  const differences = firstIds.map((fieldId) => {
    const firstValue = first.successor_state[fieldId];
    const secondValue = second.successor_state[fieldId];
    const firstScalar = scalar(firstValue);
    const secondScalar = scalar(secondValue);
    const difference = firstScalar === null || secondScalar === null
      ? null
      : secondScalar - firstScalar;
    return {
      fieldId,
      changed: JSON.stringify(firstValue) !== JSON.stringify(secondValue),
      difference,
      absoluteDifference: difference === null ? null : Math.abs(difference),
    };
  });
  const numeric = differences.filter(({ difference }) => difference !== null);
  const rms = numeric.length === 0
    ? null
    : Math.sqrt(numeric.reduce((sum, item) => sum + item.difference ** 2, 0) / numeric.length);
  return {
    sameFrozenParent: first.parent_world_hash === second.parent_world_hash,
    firstCandidateHash: first.candidate_hash,
    secondCandidateHash: second.candidate_hash,
    changedFieldCount: differences.filter(({ changed }) => changed).length,
    totalFieldCount: differences.length,
    scalarComparedFieldCount: numeric.length,
    endpointRmsDifference: rms === null ? null : Number(rms.toFixed(9)),
    largestChanges: numeric
      .sort((left, right) => right.absoluteDifference - left.absoluteDifference)
      .slice(0, 20)
      .map((item) => ({
        fieldId: item.fieldId,
        difference: Number(item.difference.toFixed(9)),
        absoluteDifference: Number(item.absoluteDifference.toFixed(9)),
      })),
  };
}

export class LifeSimulationService {
  constructor({
    backend = new RustEngineProcess(),
    maxReceiptBytes = MAX_RECEIPT_BYTES_GLOBAL,
    maxEstimationBytes = MAX_ESTIMATION_STORAGE_BYTES,
  } = {}) {
    this.backend = backend;
    this.worlds = new Map();
    this.pendingWorlds = 0;
    this.models = new Map();
    this.pendingModels = 0;
    this.presetModels = new Map();
    this.presetModelPromises = new Map();
    this.createReceipts = new Map();
    this.modelReceipts = new Map();
    this.estimationReceipts = new Map();
    this.narrativeReceipts = new Map();
    this.estimationRequests = new Map();
    this.estimationProposals = new Map();
    this.estimationReviews = new Map();
    this.maxReceiptBytes = maxReceiptBytes;
    this.receiptBytes = 0;
    this.maxEstimationBytes = maxEstimationBytes;
    this.estimationBytes = 0;
  }

  async initialize() {
    return this.backend.initialize();
  }

  async close() {
    await this.backend.close();
  }

  #reserveModel() {
    if (this.models.size + this.pendingModels >= MAX_MODELS) {
      throw new Error(`Model quota of ${MAX_MODELS} reached.`);
    }
    this.pendingModels += 1;
  }

  #reserveWorld() {
    if (this.worlds.size + this.pendingWorlds >= MAX_WORLDS) {
      throw new Error(`World quota of ${MAX_WORLDS} reached.`);
    }
    this.pendingWorlds += 1;
  }

  #reserveCandidate(world) {
    if (world.candidateIds.size + world.pendingCandidates >= MAX_CANDIDATES_PER_WORLD) {
      throw new Error(`Candidate quota of ${MAX_CANDIDATES_PER_WORLD} reached.`);
    }
    world.pendingCandidates += 1;
  }

  #retainEstimationRecord(store, id, record, maximum, label, perRecordMaximum) {
    if (store.size >= maximum) throw new Error(`${label} quota of ${maximum} reached.`);
    if (store.has(id)) throw new Error(`${label} id ${id} already exists.`);
    const bytes = Buffer.byteLength(canonicalEstimationJson(record));
    if (bytes > perRecordMaximum) {
      throw new Error(`${label} uses ${bytes} bytes; per-record limit is ${perRecordMaximum}.`);
    }
    if (this.estimationBytes + bytes > this.maxEstimationBytes) {
      throw new Error(
        `${label} would retain ${bytes} bytes; estimation storage budget is ` +
        `${this.maxEstimationBytes} bytes.`,
      );
    }
    store.set(id, structuredClone(record));
    this.estimationBytes += bytes;
  }

  async #withCandidateReservation(world, produce) {
    this.#reserveCandidate(world);
    try {
      return await produce();
    } finally {
      world.pendingCandidates -= 1;
    }
  }

  async #withIdempotentReceipt(store, operation, requestId, payload, produce) {
    ensureRequestId(requestId);
    const key = `${operation}:${requestId}`;
    const canonicalPayload = canonicalJson(payload);
    const requestPayloadHash = canonicalPayloadHash(canonicalPayload);
    const existing = store.get(key);
    if (existing) {
      if (
        existing.requestPayloadHash !== requestPayloadHash ||
        existing.canonicalPayload !== canonicalPayload
      ) {
        throw new Error(
          `requestId ${requestId} is already bound to a different ${operation} payload.`,
        );
      }
      return structuredClone(await existing.promise);
    }
    if (store.size >= MAX_RECEIPTS_PER_SCOPE) {
      throw new Error(`Idempotency-receipt quota of ${MAX_RECEIPTS_PER_SCOPE} reached.`);
    }

    const payloadBytes = Buffer.byteLength(canonicalPayload);
    const resultAllowance = receiptResultAllowance(operation);
    const initialReservation = payloadBytes + resultAllowance;
    if (this.receiptBytes + initialReservation > this.maxReceiptBytes) {
      throw new Error(
        `Idempotency receipt would reserve ${initialReservation} bytes; ` +
        `global retained-and-pending budget is ${this.maxReceiptBytes} bytes.`,
      );
    }
    this.receiptBytes += initialReservation;

    const entry = {
      canonicalPayload,
      requestPayloadHash,
      reservedBytes: initialReservation,
      promise: null,
    };
    entry.promise = (async () => {
      const receipt = await produce();
      const retained = structuredClone({ ...receipt, requestPayloadHash });
      const resultBytes = Buffer.byteLength(canonicalJson(retained));
      if (resultBytes > resultAllowance) {
        throw new ReceiptRetentionError({
          operation,
          resultBytes,
          allowance: resultAllowance,
        });
      }
      const releasedAllowance = resultAllowance - resultBytes;
      entry.reservedBytes -= releasedAllowance;
      this.receiptBytes -= releasedAllowance;
      return retained;
    })().catch((cause) => {
      if (cause?.indeterminate === true) {
        cause.receiptRetained = true;
        cause.idempotencyOperation = operation;
        cause.idempotencyRequestId = requestId;
      }
      throw cause;
    });
    store.set(key, entry);
    try {
      return structuredClone(await entry.promise);
    } catch (cause) {
      if (cause?.indeterminate === true) {
        cause.receiptRetained = true;
        throw cause;
      }
      if (store.get(key) === entry) {
        store.delete(key);
        this.receiptBytes -= entry.reservedBytes;
      }
      throw cause;
    }
  }

  async engineStatus() {
    const description = await this.initialize();
    const backendStatus = this.backend.status();
    return {
      schema: 'life-sim-mcp-status/v2',
      mcpHost: 'TypeScript/Node MCP SDK v2 over stdio',
      activeBackend: 'Life Simulation Rust machine',
      architecture: 'MCP interface/control plane over one authoritative Rust machine',
      javascriptSimulationFallback: false,
      engine: {
        ...backendStatus,
        representation: {
          valueKinds: description.value_kinds ?? [],
          operatorRoles: description.operator_roles ?? [],
          edgeKinds: description.edge_kinds ?? {},
        },
        execution: description.execution ?? null,
        operations: description.operations,
      },
      implementationCoverage: {
        normalizedSemanticFamilies: 33,
        dedicatedReusableImplementations: 12,
        partialOrFixtureCoverage: 22,
        paperOnly: 11,
        validatedLearnedCoverage: 0,
        note:
          'Generic Rust IR representability is not a claim that MCP or the runtime has a validated dedicated implementation for every semantic family.',
      },
      mcpSemanticCoverage: {
        approximateDedicatedFamilies: 10,
        normalizedSemanticFamilies: 33,
        approximateRatio: Number((10 / 33).toFixed(6)),
        note:
          'This separate MCP-facing estimate counts dedicated semantic behavior, not generic IR encodability.',
      },
      meaningModelLayer: {
        optional: true,
        authority: 'immutable Rust-stored model definition',
        mcpSurface:
          'bounded read-only query plus explicit authored refinement and revision of Rust-owned worlds, including after accepted history',
        queryableCollections: [...meaningModelCollections],
        schema: description.schemas?.meaning_model ?? null,
        rustContract: description.meaning_model ?? null,
        executableBehavior:
          'MCP does not execute Meaning Model records; Rust validates declared temporal Cut recomposition and applies explicit direct-next world revisions. Refinement preserves commitments; Revise records compatible changes. Neither invents detail or judges its plausibility. Existing history is retained; portable checkpoint/training exports spanning revisions remain unsupported.',
      },
      profileCompilation: {
        optional: true,
        mcpSurface: 'read-only Story, Person, or Decision profile compilation followed by separate explicit model registration',
        rustContract: description.profile_compilation ?? null,
        mutationBoundary:
          'compilation returns an ordinary complete model but creates no registered model, receipt, world, candidate, or durable state',
      },
      estimationExchange: {
        schema: ESTIMATION_SCHEMA,
        providerNeutral: true,
        operations: [...estimationOperations],
        intents: [...estimationIntents],
        dispositions: [...estimationDispositions],
        outputModes: [...estimationOutputModes],
        reviewVerdicts: [...estimationReviewVerdicts],
        authority:
          'immutable requests and uncommitted proposals bound to a Rust model revision and accepted Rust WorldHead',
        mutationBoundary:
          'submission and review never register a model, roll a candidate, or mutate a world; approved semantic changes name life_model_revise separately, data-only proposals have no model-registration step, and approved forward observations return a query fragment for a separate roll and explicit commit',
        observationIngestion: {
          rustHook: 'ModelTransitionSpec.observations',
          forwardTimedValues: true,
          candidateFirst: true,
          explicitCommitRequired: true,
          zeroTimeAppend: false,
          historicalAppend: false,
          persistence:
            'accepted candidates retain observed values, claims, marks, paths, and lineage; Rust state-file mode makes the accepted world durable',
        },
        evidenceCutoffBoundary:
          'historical cutoffs remain unavailable; assimilate alone may declare later external evidence while its Rust projection remains bound to the accepted head',
      },
      persistence: {
        rustAuthority: backendStatus.persistenceMode,
        rustContract: description.persistence ?? null,
        mcpControlPlane:
          'process-local handles, receipts, annotations, writer plans, and estimation records are not recovered',
      },
      graphProjection: {
        optional: true,
        authority: 'read-only projection derived from the immutable Rust model and selected model/world/candidate snapshot',
        modes: ['full', 'skeleton', 'neighborhood'],
        neighborhoodBoundary: 'every incident crossing edge and endpoint is retained',
        canonicalMutation: false,
        separateGraphStore: false,
      },
      narrativeUnderstandingGraph: {
        optional: true,
        authority: 'immutable Rust-persisted graph revisions bound to exact Rust snapshots',
        mutations: ['complete registration', 'complete revision', 'connected additive batch'],
        canonicalStoryStorage: 'addressable graph nodes; rendered documents are projections',
        nodeTypes: 'open domain vocabulary over fixed interoperable roles',
        modelAnchors: 'typed object ids plus validated nested RFC 6901 subpaths',
        modes: ['full', 'skeleton', 'neighborhood'],
        projections: ['story render', 'aligned text-state training records'],
        rustContract: description.narrative_understanding_graph ?? null,
        thoughtBoundary: 'externalized testimony only; never hidden chain-of-thought',
        privacyBoundary: 'scope-filtered projection, not authenticated confidentiality',
      },
      controlPlaneUsage: {
        retainedAndPendingReceiptBytes: this.receiptBytes,
        maxReceiptBytes: this.maxReceiptBytes,
        retainedEstimationBytes: this.estimationBytes,
        maxEstimationBytes: this.maxEstimationBytes,
      },
      limits: serviceLimits,
    };
  }

  async validateModel({ model }) {
    validateModelBounds(model);
    const result = await this.backend.call('validate_model', { model });
    return {
      schema: SERVICE_SCHEMA,
      valid: true,
      stored: false,
      modelHash: modelHashFromResult(result),
      summary: result.summary,
    };
  }

  async compileProfiles({ profileRequest }) {
    validateProfileCompilationRequest(profileRequest);
    const result = await this.backend.call('compile_profiles', {
      profile_request: profileRequest,
    });
    if (result?.stored !== false || result?.mutation_performed !== false) {
      throw new Error('Rust profile compilation violated its read-only boundary.');
    }
    validateModelBounds(result.model);
    return {
      schema: SERVICE_SCHEMA,
      valid: true,
      readOnly: true,
      stored: false,
      mutationPerformed: false,
      modelHash: modelHashFromResult(result),
      summary: structuredClone(result.summary),
      model: structuredClone(result.model),
      registrationNextStep: {
        operation: 'registerModel',
        explicit: true,
      },
    };
  }

  async registerModel({ requestId, model }) {
    validateModelBounds(model);
    return this.#withIdempotentReceipt(
      this.modelReceipts,
      'register-model',
      requestId,
      { model },
      async () => {
        this.#reserveModel();
        try {
          const result = await this.backend.call('register_model', { model });
          const modelHash = modelHashFromResult(result);
          const summary = compactModelMutationSummary(result.summary);
          this.models.set(modelHash, {
            modelHash,
            summary,
          });
          return {
            schema: SERVICE_SCHEMA,
            modelHash,
            stored: true,
            immutableRevision: true,
            summary,
          };
        } finally {
          this.pendingModels -= 1;
        }
      },
    );
  }

  async reviseModel({ requestId, previousModelHash, model }) {
    ensureHash(previousModelHash, 'previousModelHash');
    validateModelBounds(model);
    return this.#withIdempotentReceipt(
      this.modelReceipts,
      'revise-model',
      requestId,
      { previousModelHash, model },
      async () => {
        if (model?.revision?.previous_model_hash !== previousModelHash) {
          throw new Error(
            'Complete revised model must link revision.previous_model_hash to previousModelHash.',
          );
        }
        this.#reserveModel();
        try {
          const result = await this.backend.call('revise_model', { model });
          const modelHash = modelHashFromResult(result);
          const summary = compactModelMutationSummary(result.summary);
          this.models.set(modelHash, {
            modelHash,
            summary,
          });
          return {
            schema: SERVICE_SCHEMA,
            modelHash,
            previousModelHash,
            stored: true,
            atomicCompleteModelRevision: true,
            inPlacePatchApplied: false,
            summary,
          };
        } finally {
          this.pendingModels -= 1;
        }
      },
    );
  }

  async inspectModel({ modelHash, includeDefinition = false }) {
    ensureHash(modelHash, 'modelHash');
    const result = await this.backend.call('get_model', { model_hash: modelHash });
    return {
      schema: SERVICE_SCHEMA,
      modelHash,
      summary: result.summary,
      ...(includeDefinition ? { model: result.model } : {}),
    };
  }

  async queryMeaningModel({
    modelHash,
    collections = meaningModelCollections,
    ids = [],
    offset = 0,
    limit = 100,
  }) {
    ensureHash(modelHash, 'modelHash');
    validateMeaningQuery({ collections, ids, offset, limit });
    const result = await this.backend.call('get_model', { model_hash: modelHash });
    if (!isRecord(result?.model)) {
      throw new Error('Rust model response did not contain a complete model definition.');
    }
    const meaningModel = meaningModelBlock(result.model);
    const collectionCounts = {};
    const matches = [];
    const requestedIds = new Set(ids);
    const selectedCollections = new Set(collections);
    let totalRecordCount = 0;
    for (const collection of meaningModelCollections) {
      const records = meaningModel === null
        ? []
        : meaningCollectionRecords(meaningModel, collection, 'stored model.meaning_model');
      collectionCounts[collection] = records.length;
      totalRecordCount += records.length;
      if (totalRecordCount > MAX_MODEL_MEANING_RECORDS) {
        throw new Error(
          `Stored Meaning Model layer exceeds the MCP limit of ` +
          `${MAX_MODEL_MEANING_RECORDS} records.`,
        );
      }
      if (!selectedCollections.has(collection)) continue;
      for (const definition of records) {
        if (!isRecord(definition)) {
          throw new Error(`Stored Meaning Model ${collection} entry is not an object.`);
        }
        const id = meaningRecordId(collection, definition);
        ensureBoundedNonemptyString(
          id,
          `stored model.meaning_model.${collection} id`,
        );
        if (requestedIds.size > 0 && !requestedIds.has(id)) continue;
        matches.push({ collection, definition });
      }
    }

    const items = [];
    let definitionBytes = 0;
    for (const match of matches.slice(offset, offset + limit)) {
      const item = structuredClone(match);
      const itemBytes = Buffer.byteLength(JSON.stringify(item));
      if (itemBytes > MAX_MEANING_QUERY_DEFINITION_BYTES && items.length === 0) {
        throw new Error(
          `Meaning Model definition ${meaningRecordId(match.collection, match.definition)} uses ${itemBytes} bytes; ` +
          `query definition-byte limit is ${MAX_MEANING_QUERY_DEFINITION_BYTES}.`,
        );
      }
      if (definitionBytes + itemBytes > MAX_MEANING_QUERY_DEFINITION_BYTES) break;
      items.push(item);
      definitionBytes += itemBytes;
    }
    const nextOffset = offset + items.length < matches.length
      ? offset + items.length
      : null;
    return {
      schema: SERVICE_SCHEMA,
      modelHash,
      meaningModel: {
        enabled: meaningModel !== null,
        layerSchema: meaningModel?.schema ?? null,
        collectionCounts,
        totalRecordCount,
      },
      query: {
        collections: [...collections],
        ids: [...ids],
        offset,
        limit,
      },
      matchedCount: matches.length,
      returnedCount: items.length,
      definitionBytes,
      truncated: nextOffset !== null,
      nextOffset,
      items,
    };
  }

  async createEstimationRequest({
    worldId,
    requestId,
    operation,
    intent,
    evidenceCutoff,
    coordinates,
    accessScopes = [],
    context = '',
  }) {
    const world = this.getWorld(worldId);
    return this.#withIdempotentReceipt(
      this.estimationReceipts,
      'create-estimation-request',
      requestId,
      { worldId, operation, intent, evidenceCutoff, coordinates, accessScopes, context },
      async () => {
        const [head, modelResult] = await Promise.all([
          this.backend.call('get_world', { world_id: worldId }),
          this.backend.call('get_model', { model_hash: world.modelHash }),
        ]);
        if (!isRecord(modelResult?.model)) {
          throw new Error('Rust model response did not contain a complete model definition.');
        }
        if (head.model_hash !== world.modelHash || head.world_hash === undefined) {
          throw new Error('Rust world head is not bound to the service model handle.');
        }
        const processById = new Map(
          modelResult.model.processes.map((process) => [process.id, process]),
        );
        validateEstimationRequestInput({
          operation,
          intent,
          evidenceCutoff,
          coordinates,
          accessScopes,
          context,
        }, { headTime: head.time, processById });
        const requestedObservables = [...new Set(coordinates.map(({ processId }) => processId))]
          .sort();
        const evidenceProjection = await this.backend.call('query_view', {
          world_id: worldId,
          view: {
            requested_observables: requestedObservables,
            access_scopes: [...new Set(accessScopes)].sort(),
            include_path: false,
          },
        });
        if (
          evidenceProjection.world_hash !== head.world_hash ||
          evidenceProjection.version !== head.version
        ) {
          throw new Error('Accepted world head changed while the estimation request was created.');
        }
        const estimationRequestId = `estimation_request_${randomUUID()}`;
        const record = {
          schema: ESTIMATION_SCHEMA,
          estimationRequestId,
          immutable: true,
          operation,
          intent,
          evidenceCutoff,
          coordinates: structuredClone(coordinates),
          accessScopes: [...new Set(accessScopes)].sort(),
          context,
          worldId,
          modelHash: world.modelHash,
          modelRevision: head.model_revision,
          acceptedHeadHash: head.world_hash,
          acceptedHeadVersion: head.version,
          acceptedHeadTime: head.time,
          evidenceProjection: {
            state: structuredClone(evidenceProjection.state ?? {}),
            claims: structuredClone(evidenceProjection.claims ?? {}),
          },
        };
        this.#retainEstimationRecord(
          this.estimationRequests,
          estimationRequestId,
          record,
          MAX_ESTIMATION_REQUESTS,
          'Estimation request',
          MAX_ESTIMATION_REQUEST_BYTES,
        );
        return structuredClone(record);
      },
    );
  }

  async submitEstimationResponse({
    estimationRequestId,
    requestId,
    dispositions,
    provisionalClaims = [],
    semanticChanges = [],
    proposedModel,
    proposalReason,
  }) {
    ensureHandle(estimationRequestId, 'estimationRequestId');
    const estimationRequest = this.estimationRequests.get(estimationRequestId);
    if (!estimationRequest) throw new Error('Unknown or inaccessible estimationRequestId.');
    if (proposedModel !== undefined && proposedModel !== null) {
      validateModelBounds(proposedModel);
    }
    return this.#withIdempotentReceipt(
      this.estimationReceipts,
      'submit-estimation-response',
      requestId,
      {
        estimationRequestId,
        dispositions,
        provisionalClaims,
        semanticChanges,
        proposedModel,
        proposalReason,
      },
      async () => {
        const [head, baseModelResult] = await Promise.all([
          this.backend.call('get_world', { world_id: estimationRequest.worldId }),
          this.backend.call('get_model', { model_hash: estimationRequest.modelHash }),
        ]);
        if (
          head.world_hash !== estimationRequest.acceptedHeadHash ||
          head.version !== estimationRequest.acceptedHeadVersion
        ) {
          throw new Error(
            'Estimation request is stale because its accepted Rust world head has changed.',
          );
        }
        if (!isRecord(baseModelResult?.model)) {
          throw new Error('Rust model response did not contain the complete base model.');
        }
        const comparison = validateEstimationResponseInput({
          dispositions,
          provisionalClaims,
          semanticChanges,
          proposedModel,
          proposalReason,
        }, {
          request: estimationRequest,
          baseModel: baseModelResult.model,
          worldProjection: {
            ...estimationRequest.evidenceProjection,
            // Integrity checks use the complete accepted-head claim set even
            // when the provider was shown only a scoped projection.
            claims: structuredClone(head.claims ?? {}),
          },
          meaningCollections: meaningModelCollections,
        });
        const validation = comparison.modelProposalIncluded
          ? await this.backend.call('validate_model', { model: proposedModel })
          : null;
        const proposedModelHash = validation === null ? null : modelHashFromResult(validation);
        const proposalId = `estimation_proposal_${randomUUID()}`;
        const observationMaterializationPlan = buildObservationMaterializationPlan({
          request: estimationRequest,
          provisionalClaims,
          baseModel: baseModelResult.model,
        });
        const proposal = {
          schema: ESTIMATION_SCHEMA,
          proposalId,
          estimationRequestId,
          immutable: true,
          committed: false,
          worldMutationPerformed: false,
          modelRegistrationPerformed: false,
          baseModelHash: estimationRequest.modelHash,
          baseModelRevision: estimationRequest.modelRevision,
          acceptedHeadHash: estimationRequest.acceptedHeadHash,
          acceptedHeadVersion: estimationRequest.acceptedHeadVersion,
          modelProposalIncluded: comparison.modelProposalIncluded,
          ...(comparison.modelProposalIncluded
            ? {
                proposedModelHash,
                proposedModel: structuredClone(proposedModel),
                validationSummary: structuredClone(validation.summary),
                proposalReason,
              }
            : {
                ...(proposalReason === undefined || proposalReason === null
                  ? {}
                  : { proposalReason }),
              }),
          dispositions: structuredClone(dispositions),
          provisionalClaims: structuredClone(provisionalClaims),
          semanticChanges: structuredClone(semanticChanges),
          strongerClaimConflicts: comparison.strongerClaimConflicts,
          observationMaterializationPlan,
          observationIngestion: observationMaterializationPlan.status === 'not_requested'
            ? { status: 'not_requested' }
            : {
                status: 'review_required',
                rustHook: 'ModelTransitionSpec.observations',
                observedOutputCount: observationMaterializationPlan.observationCount,
                materializationPerformed: false,
                canonical: false,
                note:
                  'Rust can ingest positive forward observations through an ordinary candidate query, but this proposal must be approved before its exact query fragment is returned.',
              },
        };
        this.#retainEstimationRecord(
          this.estimationProposals,
          proposalId,
          proposal,
          MAX_ESTIMATION_PROPOSALS,
          'Estimation proposal',
          MAX_ESTIMATION_PROPOSAL_BYTES,
        );
        const dispositionCounts = Object.fromEntries(
          estimationDispositions.map((status) => [
            status,
            dispositions.filter((entry) => entry.status === status).length,
          ]),
        );
        return {
          schema: ESTIMATION_SCHEMA,
          proposalId,
          estimationRequestId,
          committed: false,
          modelRegistrationPerformed: false,
          worldMutationPerformed: false,
          baseModelHash: proposal.baseModelHash,
          modelProposalIncluded: proposal.modelProposalIncluded,
          rustValidated: proposal.modelProposalIncluded,
          rustValidationNotApplicable: !proposal.modelProposalIncluded,
          ...(proposal.modelProposalIncluded ? { proposedModelHash } : {}),
          dispositionCounts,
          provisionalClaimCount: provisionalClaims.length,
          semanticChangeCount: semanticChanges.length,
          strongerClaimConflicts: comparison.strongerClaimConflicts,
          observationIngestion: proposal.observationIngestion,
          reviewRequired: true,
        };
      },
    );
  }

  async inspectEstimationProposal({ proposalId, includeProposedModel = false }) {
    ensureHandle(proposalId, 'proposalId');
    const proposal = this.estimationProposals.get(proposalId);
    if (!proposal) throw new Error('Unknown or inaccessible estimation proposal.');
    const reviews = [...this.estimationReviews.values()]
      .filter((review) => review.proposalId === proposalId)
      .map((review) => structuredClone(review));
    return {
      schema: ESTIMATION_SCHEMA,
      proposalId,
      estimationRequestId: proposal.estimationRequestId,
      immutable: true,
      committed: false,
      modelRegistrationPerformed: false,
      worldMutationPerformed: false,
      baseModelHash: proposal.baseModelHash,
      modelProposalIncluded: proposal.modelProposalIncluded,
      ...(proposal.modelProposalIncluded
        ? {
            proposedModelHash: proposal.proposedModelHash,
            validationSummary: structuredClone(proposal.validationSummary),
            proposalReason: proposal.proposalReason,
          }
        : {
            ...(proposal.proposalReason === undefined
              ? {}
              : { proposalReason: proposal.proposalReason }),
          }),
      dispositions: structuredClone(proposal.dispositions),
      provisionalClaims: structuredClone(proposal.provisionalClaims),
      semanticChanges: structuredClone(proposal.semanticChanges),
      strongerClaimConflicts: structuredClone(proposal.strongerClaimConflicts),
      observationIngestion: structuredClone(proposal.observationIngestion),
      reviews,
      ...(includeProposedModel && proposal.modelProposalIncluded
        ? { proposedModel: structuredClone(proposal.proposedModel) }
        : {}),
    };
  }

  async reviewEstimationProposal({ proposalId, requestId, verdict, rationale }) {
    ensureHandle(proposalId, 'proposalId');
    validateEstimationReviewInput({ verdict, rationale });
    const proposal = this.estimationProposals.get(proposalId);
    if (!proposal) throw new Error('Unknown or inaccessible estimation proposal.');
    return this.#withIdempotentReceipt(
      this.estimationReceipts,
      'review-estimation-proposal',
      requestId,
      { proposalId, verdict, rationale },
      async () => {
        const estimationRequest = this.estimationRequests.get(proposal.estimationRequestId);
        if (!estimationRequest) {
          throw new Error('Estimation proposal has lost its immutable request binding.');
        }
        const head = await this.backend.call('get_world', {
          world_id: estimationRequest.worldId,
        });
        const stale =
          head.world_hash !== proposal.acceptedHeadHash ||
          head.version !== proposal.acceptedHeadVersion;
        if (verdict === 'approved' && stale) {
          throw new Error('A stale estimation proposal cannot be approved.');
        }
        if (proposal.modelProposalIncluded) {
          const validation = await this.backend.call('validate_model', {
            model: proposal.proposedModel,
          });
          const revalidatedHash = modelHashFromResult(validation);
          if (revalidatedHash !== proposal.proposedModelHash) {
            throw new Error('Proposed model hash changed during Rust revalidation.');
          }
        }
        const reviewId = `estimation_review_${randomUUID()}`;
        const review = {
          schema: ESTIMATION_SCHEMA,
          reviewId,
          proposalId,
          immutable: true,
          verdict,
          rationale,
          stale,
          modelProposalIncluded: proposal.modelProposalIncluded,
          rustRevalidated: proposal.modelProposalIncluded,
          rustRevalidationNotApplicable: !proposal.modelProposalIncluded,
          committed: false,
          modelRegistrationPerformed: false,
          worldMutationPerformed: false,
          ...(verdict === 'approved'
            ? {
                ...(proposal.modelProposalIncluded
                  ? {
                      registrationNextStep: {
                        tool: 'life_model_revise',
                        requiresExplicitSeparateCall: true,
                        previousModelHash: proposal.baseModelHash,
                        proposedModelHash: proposal.proposedModelHash,
                        obtainCompleteModelWith: {
                          tool: 'life_estimation_proposal_inspect',
                          arguments: { proposalId, includeProposedModel: true },
                        },
                      },
                    }
                  : {}),
                ...(proposal.observationMaterializationPlan.status === 'not_requested'
                  ? {}
                  : {
                      observationMaterializationNextStep: structuredClone(
                        proposal.observationMaterializationPlan,
                      ),
                    }),
              }
            : {}),
        };
        this.#retainEstimationRecord(
          this.estimationReviews,
          reviewId,
          review,
          MAX_ESTIMATION_REVIEWS,
          'Estimation review',
          MAX_ESTIMATION_REVIEW_BYTES,
        );
        return structuredClone(review);
      },
    );
  }

  async #ensurePresetModel(presetId) {
    if (this.presetModels.has(presetId)) return this.presetModels.get(presetId);
    if (!hasNorthHarborPreset(presetId)) throw new Error(`Unsupported presetId ${presetId}.`);
    const existingPromise = this.presetModelPromises.get(presetId);
    if (existingPromise) return existingPromise;
    const registration = (async () => {
      this.#reserveModel();
      try {
        const model = loadNorthHarborModel(presetId);
        const result = await this.backend.call('register_model', { model });
        const modelHash = modelHashFromResult(result);
        const summary = compactModelMutationSummary(result.summary);
        this.models.set(modelHash, {
          modelHash,
          summary,
          presetId,
        });
        this.presetModels.set(presetId, modelHash);
        return modelHash;
      } finally {
        this.pendingModels -= 1;
      }
    })();
    this.presetModelPromises.set(presetId, registration);
    try {
      return await registration;
    } finally {
      if (this.presetModelPromises.get(presetId) === registration) {
        this.presetModelPromises.delete(presetId);
      }
    }
  }

  async createWorld({ requestId, presetId = null, modelHash = null }) {
    if (modelHash !== null) ensureHash(modelHash, 'modelHash');
    return this.#withIdempotentReceipt(
      this.createReceipts,
      'create-world',
      requestId,
      { presetId, modelHash },
      async () => {
        if (presetId && modelHash) throw new Error('Choose presetId or modelHash, not both.');
        this.#reserveWorld();
        try {
          const selectedPreset = modelHash ? null : (presetId ?? 'north-harbor/12');
          const selectedModelHash = modelHash ?? await this.#ensurePresetModel(selectedPreset);
          const model = await this.backend.call('get_model', { model_hash: selectedModelHash });
          const processIds = processIdsFromModelResult(model);
          const fieldCount = model.summary.process_count ?? model.summary.process_ids?.length;
          const persistence = this.backend.status().persistenceMode;
          const worldId = `world_${randomUUID()}`;
          const world = {
            id: worldId,
            presetId: selectedPreset,
            modelHash: selectedModelHash,
            processIds,
            candidateIds: new Map(),
            pendingCandidates: 0,
            candidateViews: new Map(),
            evaluations: [],
            pendingEvaluations: 0,
            receipts: new Map(),
            writerContracts: new Map(),
            pendingWriterContracts: 0,
            writerPlans: new Map(),
            pendingWriterPlans: 0,
          };
          const head = await this.backend.call('create_world', {
            model_hash: selectedModelHash,
            world_id: worldId,
          });
          this.worlds.set(worldId, world);
          return {
            schema: SERVICE_SCHEMA,
            worldId,
            presetId: selectedPreset,
            modelHash: selectedModelHash,
            registryHash: selectedModelHash,
            headHash: head.world_hash,
            headVersion: head.version,
            fieldCount,
            canonical: true,
            persistence,
          };
        } finally {
          this.pendingWorlds -= 1;
        }
      },
    );
  }

  async refineGenesisWorld({
    worldId,
    requestId,
    targetModelHash,
    requestedObservables = [],
    accessScopes = [],
    includePath = false,
  }) {
    const world = this.getWorld(worldId);
    ensureHash(targetModelHash, 'targetModelHash');
    ensureBoundedStringArray(requestedObservables, 'requestedObservables', MAX_VIEW_FIELDS);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    if (typeof includePath !== 'boolean') throw new Error('includePath must be boolean.');
    const view = {
      requested_observables: [...new Set(requestedObservables)].sort(),
      access_scopes: [...new Set(accessScopes)].sort(),
      include_path: includePath,
    };
    return this.#withIdempotentReceipt(
      world.receipts,
      'refine-genesis-world',
      requestId,
      { worldId, targetModelHash, view },
      async () => {
        const sourceModelHash = world.modelHash;
        const targetModel = await this.backend.call('get_model', {
          model_hash: targetModelHash,
        });
        const processIds = processIdsFromModelResult(targetModel);
        const result = await this.backend.call('refine_genesis_world', {
          world_id: worldId,
          model_hash: targetModelHash,
          view,
        });
        world.modelHash = targetModelHash;
        world.processIds = processIds;
        // A caller-authored successor is no longer exactly one of the approved
        // built-in presets; subsequent rolls therefore require an explicit query.
        world.presetId = null;
        return {
          schema: SERVICE_SCHEMA,
          operation: 'refine-genesis-world',
          worldId,
          sourceModelHash: result.source_model_hash ?? sourceModelHash,
          targetModelHash: result.target_model_hash ?? targetModelHash,
          modelHash: targetModelHash,
          boundary: result.boundary,
          conservation: structuredClone(result.conservation),
          records: structuredClone(result.records),
          limitations: structuredClone(result.limitations),
          projection: structuredClone(result.world_head),
          canonical: true,
          authoredRefinement: true,
          automaticDiscoveryPerformed: false,
          postHistoryMigrationPerformed: false,
        };
      },
    );
  }

  async reviseWorld({
    worldId,
    requestId,
    expectedWorldHash,
    targetModelHash,
    mode,
    stateValues = {},
    reason,
    provenance,
    requestedObservables = [],
    accessScopes = [],
  }) {
    const world = this.getWorld(worldId);
    ensureHash(expectedWorldHash, 'expectedWorldHash');
    ensureHash(targetModelHash, 'targetModelHash');
    if (!['refine', 'revise'].includes(mode)) throw new Error('mode must be refine or revise.');
    if (!isRecord(stateValues)) throw new Error('stateValues must be an object.');
    if (Object.keys(stateValues).length > MAX_MODEL_PROCESSES) {
      throw new Error('stateValues exceeds the process limit.');
    }
    ensureBoundedNonemptyString(reason, 'reason');
    ensureBoundedStringArray(provenance, 'provenance', 64);
    if (provenance.length === 0) throw new Error('provenance must not be empty.');
    ensureBoundedStringArray(requestedObservables, 'requestedObservables', MAX_VIEW_FIELDS);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    const revision = {
      expected_world_hash: expectedWorldHash,
      mode,
      state_values: structuredClone(stateValues),
      reason,
      provenance: [...provenance],
    };
    validateAggregateJsonBytes(revision, 'worldRevision', MAX_MODEL_BYTES);
    const view = {
      requested_observables: [...new Set(requestedObservables)].sort(),
      access_scopes: [...new Set(accessScopes)].sort(),
      include_path: false,
    };
    return this.#withIdempotentReceipt(
      world.receipts,
      'revise-world',
      requestId,
      { worldId, targetModelHash, revision, view },
      async () => {
        const targetModel = await this.backend.call('get_model', { model_hash: targetModelHash });
        const processIds = processIdsFromModelResult(targetModel);
        const result = await this.backend.call('revise_world', {
          world_id: worldId,
          model_hash: targetModelHash,
          world_revision: revision,
          view,
        });
        // Only adopt the model handle after Rust has accepted the exact-head revision.
        // Existing candidates and narrative graphs remain pinned to their old sources.
        world.modelHash = targetModelHash;
        world.processIds = processIds;
        world.presetId = null;
        return {
          ...structuredClone(result),
          schema: SERVICE_SCHEMA,
          operation: 'revise-world',
          worldId,
          modelHash: targetModelHash,
          canonical: true,
        };
      },
    );
  }

  async inspectWorldRevision({ revisionHash, requestedObservables = [], accessScopes = [] }) {
    ensureHash(revisionHash, 'revisionHash');
    ensureBoundedStringArray(requestedObservables, 'requestedObservables', MAX_VIEW_FIELDS);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    return this.backend.call('get_world_revision', {
      world_revision_hash: revisionHash,
      view: {
        requested_observables: [...new Set(requestedObservables)].sort(),
        access_scopes: [...new Set(accessScopes)].sort(),
        include_path: false,
      },
    });
  }

  getWorld(worldId) {
    ensureHandle(worldId, 'worldId');
    const world = this.worlds.get(worldId);
    if (!world) throw new Error('Unknown or inaccessible worldId.');
    return world;
  }

  async inspectWorld({ worldId }) {
    const world = this.getWorld(worldId);
    const [head, model] = await Promise.all([
      this.backend.call('get_world', { world_id: worldId }),
      this.backend.call('get_model', { model_hash: world.modelHash }),
    ]);
    return {
      schema: SERVICE_SCHEMA,
      worldId,
      presetId: world.presetId,
      modelHash: world.modelHash,
      registryHash: world.modelHash,
      headHash: head.world_hash,
      headVersion: head.version,
      time: head.time,
      fieldCount: model.summary.process_count ?? model.summary.process_ids?.length,
      lawCount: model.summary.law_count ?? model.summary.law_ids?.length,
      lineageLength: head.version,
      retainedCandidateCount: world.candidateIds.size,
      evaluationCount: world.evaluations.length,
      canonical: true,
      stateAuthority: 'Rust WorldHead',
    };
  }

  async queryView({
    worldId,
    candidateId: id = null,
    requestedObservables = [],
    accessScopes = [],
    includePath = false,
  }) {
    const world = this.getWorld(worldId);
    ensureBoundedStringArray(requestedObservables, 'requestedObservables', MAX_VIEW_FIELDS);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    const source = id === null
      ? { world_id: worldId }
      : { candidate_hash: this.candidateHash(world, id) };
    const projection = await this.backend.call('query_view', {
      ...source,
      view: {
        requested_observables: [...new Set(requestedObservables)].sort(),
        access_scopes: [...new Set(accessScopes)].sort(),
        include_path: includePath,
      },
    });
    return {
      schema: SERVICE_SCHEMA,
      worldId,
      source: id === null ? 'canonical-world' : 'candidate',
      ...(id === null ? {} : { candidateId: id }),
      accessEnforcement: 'Rust model view',
      projection,
    };
  }

  async queryGraph({
    source,
    mode,
    centerNodeId = null,
    depth = 1,
    direction = 'both',
    includeValues = false,
    accessScopes = [],
    expectedSnapshotHash = null,
  }) {
    if (!isRecord(source)) throw new Error('source must be an object.');
    if (!['model', 'world', 'candidate'].includes(source.kind)) {
      throw new Error('source.kind must be model, world, or candidate.');
    }
    const sourcePayload = (() => {
      if (source.kind === 'model') {
        ensureHash(source.modelHash, 'source.modelHash');
        return { model_hash: source.modelHash };
      }
      if (source.kind === 'world') {
        ensureHandle(source.worldId, 'source.worldId');
        return { world_id: source.worldId };
      }
      ensureHash(source.candidateHash, 'source.candidateHash');
      return { candidate_hash: source.candidateHash };
    })();
    if (!['full', 'skeleton', 'neighborhood'].includes(mode)) {
      throw new Error('mode must be full, skeleton, or neighborhood.');
    }
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    if (typeof includeValues !== 'boolean') throw new Error('includeValues must be boolean.');
    if (
      expectedSnapshotHash !== null &&
      !/^[a-f0-9]{64}$/u.test(expectedSnapshotHash)
    ) {
      throw new Error('expectedSnapshotHash must be a lowercase SHA-256 digest.');
    }
    const graphQuery = {
      mode,
      include_values: includeValues,
      access_scopes: [...new Set(accessScopes)].sort(),
      ...(expectedSnapshotHash === null
        ? {}
        : { expected_snapshot_hash: expectedSnapshotHash }),
    };
    if (mode === 'neighborhood') {
      ensureBoundedNonemptyString(centerNodeId, 'centerNodeId');
      if (!Number.isInteger(depth) || depth < 0 || depth > MAX_GRAPH_NEIGHBORHOOD_DEPTH) {
        throw new Error(
          `depth must be an integer from 0 through ${MAX_GRAPH_NEIGHBORHOOD_DEPTH}.`,
        );
      }
      if (!['ancestors', 'descendants', 'both'].includes(direction)) {
        throw new Error('direction must be ancestors, descendants, or both.');
      }
      graphQuery.center = centerNodeId;
      graphQuery.depth = depth;
      graphQuery.direction = direction;
    }
    return this.backend.call('query_graph', {
      ...sourcePayload,
      graph_query: graphQuery,
    });
  }

  async registerNarrativeGraph({ requestId, narrativeGraph }) {
    validateNarrativeGraphInput(narrativeGraph);
    if (narrativeGraph.revision.number !== 0) {
      throw new Error('Narrative registration requires revision 0.');
    }
    return this.#withIdempotentReceipt(
      this.narrativeReceipts,
      'register-narrative-graph',
      requestId,
      { narrativeGraph },
      async () => {
        const result = await this.backend.call('register_narrative_graph', {
          narrative_graph: narrativeGraph,
        });
        return {
          schema: SERVICE_SCHEMA,
          graphHash: result.summary.graph_hash,
          snapshotHash: result.snapshot_hash,
          stored: result.stored === true,
          reusedExisting: result.reused_existing === true,
          immutableRevision: true,
          summary: structuredClone(result.summary),
        };
      },
    );
  }

  async reviseNarrativeGraph({ requestId, previousGraphHash, narrativeGraph }) {
    ensureHash(previousGraphHash, 'previousGraphHash');
    validateNarrativeGraphInput(narrativeGraph);
    if (narrativeGraph.revision.number === 0) {
      throw new Error('Narrative revision requires a nonzero revision number.');
    }
    if (narrativeGraph.revision.previous_graph_hash !== previousGraphHash) {
      throw new Error(
        'Complete narrative revision must link revision.previous_graph_hash to previousGraphHash.',
      );
    }
    return this.#withIdempotentReceipt(
      this.narrativeReceipts,
      'revise-narrative-graph',
      requestId,
      { previousGraphHash, narrativeGraph },
      async () => {
        const result = await this.backend.call('revise_narrative_graph', {
          narrative_graph: narrativeGraph,
        });
        return {
          schema: SERVICE_SCHEMA,
          graphHash: result.summary.graph_hash,
          previousGraphHash,
          snapshotHash: result.snapshot_hash,
          stored: result.stored === true,
          reusedExisting: result.reused_existing === true,
          immutableRevision: true,
          summary: structuredClone(result.summary),
        };
      },
    );
  }

  async applyNarrativeBatch({ requestId, previousGraphHash, narrativeBatch }) {
    ensureHash(previousGraphHash, 'previousGraphHash');
    validateNarrativeBatchInput(narrativeBatch);
    if (narrativeBatch.previous_graph_hash !== previousGraphHash) {
      throw new Error(
        'Additive narrative batch must link previous_graph_hash to previousGraphHash.',
      );
    }
    return this.#withIdempotentReceipt(
      this.narrativeReceipts,
      'apply-narrative-batch',
      requestId,
      { previousGraphHash, narrativeBatch },
      async () => {
        const result = await this.backend.call('apply_narrative_batch', {
          narrative_batch: narrativeBatch,
        });
        return {
          schema: SERVICE_SCHEMA,
          graphHash: result.summary.graph_hash,
          previousGraphHash,
          snapshotHash: result.snapshot_hash,
          stored: result.stored === true,
          reusedExisting: result.reused_existing === true,
          immutableRevision: true,
          additiveBatch: true,
          batch: structuredClone(result.batch),
          summary: structuredClone(result.summary),
        };
      },
    );
  }

  async queryNarrativeGraph({
    graphHash,
    mode,
    includeContent = false,
    centerNodeId = null,
    depth = 1,
    direction = 'both',
    accessScopes = [],
    expectedGraphHash = null,
  }) {
    ensureHash(graphHash, 'graphHash');
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    if (!['full', 'skeleton', 'neighborhood'].includes(mode)) {
      throw new Error('mode must be full, skeleton, or neighborhood.');
    }
    if (typeof includeContent !== 'boolean') throw new Error('includeContent must be boolean.');
    if (expectedGraphHash !== null) ensureHash(expectedGraphHash, 'expectedGraphHash');
    const narrativeQuery = {
      mode,
      access_scopes: [...new Set(accessScopes)].sort(),
      ...(mode === 'skeleton' ? {} : { include_content: includeContent }),
      ...(expectedGraphHash === null ? {} : { expected_graph_hash: expectedGraphHash }),
    };
    if (mode === 'neighborhood') {
      ensureBoundedNonemptyString(centerNodeId, 'centerNodeId');
      if (!Number.isInteger(depth) || depth < 0 || depth > MAX_GRAPH_NEIGHBORHOOD_DEPTH) {
        throw new Error(
          `depth must be an integer from 0 through ${MAX_GRAPH_NEIGHBORHOOD_DEPTH}.`,
        );
      }
      if (!['ancestors', 'descendants', 'both'].includes(direction)) {
        throw new Error('direction must be ancestors, descendants, or both.');
      }
      narrativeQuery.center_node_id = centerNodeId;
      narrativeQuery.depth = depth;
      narrativeQuery.direction = direction;
    }
    return this.backend.call('query_narrative_graph', {
      narrative_graph_hash: graphHash,
      narrative_query: narrativeQuery,
    });
  }

  async renderNarrativeGraph({
    graphHash,
    rootIds = [],
    accessScopes = [],
    expectedGraphHash = null,
  }) {
    ensureHash(graphHash, 'graphHash');
    ensureBoundedStringArray(rootIds, 'rootIds', MAX_NARRATIVE_ROOTS);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    if (expectedGraphHash !== null) ensureHash(expectedGraphHash, 'expectedGraphHash');
    return this.backend.call('render_narrative_graph', {
      narrative_graph_hash: graphHash,
      narrative_render: {
        root_ids: [...new Set(rootIds)],
        access_scopes: [...new Set(accessScopes)].sort(),
        ...(expectedGraphHash === null ? {} : { expected_graph_hash: expectedGraphHash }),
      },
    });
  }

  async exportNarrativeTraining({
    graphHash,
    nodeIds = [],
    accessScopes = [],
    includeLinkedValues = true,
    requireAcceptedHistory = false,
    expectedGraphHash = null,
  }) {
    ensureHash(graphHash, 'graphHash');
    ensureBoundedStringArray(nodeIds, 'nodeIds', MAX_NARRATIVE_NODES);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    if (typeof includeLinkedValues !== 'boolean') {
      throw new Error('includeLinkedValues must be boolean.');
    }
    if (typeof requireAcceptedHistory !== 'boolean') {
      throw new Error('requireAcceptedHistory must be boolean.');
    }
    if (expectedGraphHash !== null) ensureHash(expectedGraphHash, 'expectedGraphHash');
    return this.backend.call('export_narrative_training', {
      narrative_graph_hash: graphHash,
      narrative_training: {
        node_ids: [...new Set(nodeIds)].sort(),
        access_scopes: [...new Set(accessScopes)].sort(),
        include_linked_values: includeLinkedValues,
        require_accepted_history: requireAcceptedHistory,
        ...(expectedGraphHash === null ? {} : { expected_graph_hash: expectedGraphHash }),
      },
    });
  }

  async rollCandidate({
    worldId,
    requestId,
    deltaTime = 0.25,
    stepSize = 1 / 24,
    seed = 'life-simulation-mcp',
    forcingEnabled = true,
    query = null,
  }) {
    const world = this.getWorld(worldId);
    validatePositiveBoundedNumber(deltaTime, 'deltaTime', MAX_QUERY_DELTA_TIME);
    validatePositiveBoundedNumber(stepSize, 'stepSize', MAX_QUERY_STEP_SIZE);
    ensureBoundedNonemptyString(seed, 'seed');
    if (query !== null) validateTransitionQuery(query);
    return this.#withIdempotentReceipt(
      world.receipts,
      'roll-candidate',
      requestId,
      { worldId, deltaTime, stepSize, seed, forcingEnabled, query },
      async () => {
        if (!world.presetId && query === null) {
          throw new Error(
            'Generic-model rolls require an explicit query with observables and access scopes.',
          );
        }
        return this.#withCandidateReservation(world, async () => {
          let rustQuery = query;
          if (rustQuery === null) {
            const head = await this.backend.call('get_world', {
              world_id: worldId,
              view: {
                requested_observables: world.processIds,
                access_scopes: ['world'],
                include_path: false,
              },
            });
            rustQuery = {
              schema: QUERY_SCHEMA,
              delta_time: deltaTime,
              step_size: stepSize,
              seed,
              roll_index: 0,
              direction: 'forward',
              precedence: 'balanced',
              selected_support: [],
              requested_observables: world.processIds,
              access_scopes: ['world'],
              interventions: forcingInterventions(head, deltaTime, forcingEnabled),
              path: { mode: 'full' },
            };
          }
          validateTransitionQuery(rustQuery);
          const record = await this.backend.call('roll_world', {
            world_id: worldId,
            query: rustQuery,
          });
          const id = candidateId(record.candidate.candidate_hash);
          const reusedExisting = world.candidateIds.has(id);
          world.candidateIds.set(id, record.candidate.candidate_hash);
          world.candidateViews.set(id, {
            requested_observables: record.candidate.query.requested_observables,
            access_scopes: record.candidate.query.access_scopes,
            include_path: true,
          });
          return {
            schema: SERVICE_SCHEMA,
            worldId,
            ...compactCandidate(record, id),
            candidateStoreChanged: !reusedExisting || record.retention_upgraded === true,
            acceptedHeadChanged: false,
            reusedExisting,
          };
        });
      },
    );
  }

  candidateHash(world, id) {
    ensureHandle(id, 'candidateId');
    const candidateHash = world.candidateIds.get(id);
    if (!candidateHash) throw new Error('Unknown or inaccessible candidateId.');
    return candidateHash;
  }

  async getCandidate(world, id) {
    ensureHandle(id, 'candidateId');
    const view = world.candidateViews.get(id);
    if (!view) throw new Error('Candidate has no retained Rust projection context.');
    return this.backend.call('query_view', {
      candidate_hash: this.candidateHash(world, id),
      view,
    });
  }

  async rerollCandidate({ worldId, candidateId: sourceId, requestId }) {
    const world = this.getWorld(worldId);
    ensureHandle(sourceId, 'candidateId');
    return this.#withIdempotentReceipt(
      world.receipts,
      'reroll-candidate',
      requestId,
      { worldId, sourceCandidateId: sourceId },
      async () => {
        const sourceHash = this.candidateHash(world, sourceId);
        const sourceView = world.candidateViews.get(sourceId);
        if (!sourceView) throw new Error('Candidate has no retained Rust projection context.');
        return this.#withCandidateReservation(world, async () => {
          const sourceBefore = await this.getCandidate(world, sourceId);
          const record = await this.backend.call('reroll_candidate', {
            candidate_hash: sourceHash,
            view: sourceView,
          });
          const id = candidateId(record.candidate.candidate_hash);
          const reusedExisting = world.candidateIds.has(id);
          world.candidateIds.set(id, record.candidate.candidate_hash);
          world.candidateViews.set(id, {
            requested_observables: record.candidate.query.requested_observables,
            access_scopes: record.candidate.query.access_scopes,
            include_path: true,
          });
          return {
            schema: SERVICE_SCHEMA,
            worldId,
            sourceCandidateId: sourceId,
            ...compactCandidate(record, id),
            candidateStoreChanged:
              sourceBefore.status === 'pending' ||
              !reusedExisting ||
              record.retention_upgraded === true,
            acceptedHeadChanged: false,
            reusedExisting,
            fixedInputs: true,
            rerolledStreams: 'all declared named Rust random streams',
          };
        });
      },
    );
  }

  async rejectCandidate({ worldId, candidateId: id, requestId }) {
    const world = this.getWorld(worldId);
    ensureHandle(id, 'candidateId');
    return this.#withIdempotentReceipt(
      world.receipts,
      'reject-candidate',
      requestId,
      { worldId, candidateId: id },
      async () => {
        const hash = this.candidateHash(world, id);
        const view = world.candidateViews.get(id);
        if (!view) throw new Error('Candidate has no retained Rust projection context.');
        const before = await this.getCandidate(world, id);
        const record = before.status === 'rejected'
          ? before
          : await this.backend.call('reject_candidate', {
              candidate_hash: hash,
              view,
            });
        return {
          schema: SERVICE_SCHEMA,
          worldId,
          ...compactCandidate(record, id),
          candidateStoreChanged: before.status !== record.status,
          acceptedHeadChanged: false,
          reusedExisting: false,
          rejected: true,
          canonicalWorldMutation: false,
        };
      },
    );
  }

  async observeCandidate({ worldId, candidateId: id, fieldPrefixes = [] }) {
    const world = this.getWorld(worldId);
    validatePrefixes(fieldPrefixes);
    const record = await this.getCandidate(world, id);
    const candidate = record.candidate;
    const beginning = startState(candidate);
    const selectedIds = Object.keys(candidate.successor_state)
      .sort()
      .filter((fieldId) => matchesPrefixes(fieldId, fieldPrefixes));
    const changes = beginning
      ? selectedIds.flatMap((fieldId) => {
          const start = scalar(beginning[fieldId]);
          const end = scalar(candidate.successor_state[fieldId]);
          return start === null || end === null ? [] : [{ fieldId, start, end, change: end - start }];
        })
      : [];
    return {
      schema: SERVICE_SCHEMA,
      worldId,
      candidate: compactCandidate(record, id),
      selectedFieldCount: selectedIds.length,
      scalarSelectedFieldCount: changes.length,
      nonScalarSelectedFieldCount: selectedIds.length - changes.length,
      endpoint: stats(changes.map(({ end }) => end)),
      absoluteChange: stats(changes.map(({ change }) => Math.abs(change))),
      largestChanges: changes
        .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))
        .slice(0, 25)
        .map((item) => ({ ...item, change: Number(item.change.toFixed(9)) })),
      pathRetainsStartState: beginning !== null,
      proseGenerated: false,
    };
  }

  async compareCandidates({ worldId, firstCandidateId, secondCandidateId }) {
    const world = this.getWorld(worldId);
    const [first, second] = await Promise.all([
      this.getCandidate(world, firstCandidateId),
      this.getCandidate(world, secondCandidateId),
    ]);
    return {
      schema: SERVICE_SCHEMA,
      worldId,
      ...endpointDifferences(first.candidate, second.candidate),
    };
  }

  async queryTrajectory({
    worldId,
    candidateId: id,
    fieldPrefixes = [],
    sampleEvery = 1,
    maxFields = 25,
  }) {
    const world = this.getWorld(worldId);
    validatePrefixes(fieldPrefixes);
    const record = await this.getCandidate(world, id);
    if (!Number.isInteger(sampleEvery) || sampleEvery < 1) {
      throw new Error('sampleEvery must be a positive integer.');
    }
    if (!Number.isInteger(maxFields) || maxFields < 1 || maxFields > MAX_TRAJECTORY_FIELDS) {
      throw new Error(`maxFields must be between 1 and ${MAX_TRAJECTORY_FIELDS}.`);
    }
    const sourceSamples = record.candidate.path?.samples ?? [];
    const matchingFieldIds = Object.keys(record.candidate.successor_state)
      .sort()
      .filter((fieldId) => matchesPrefixes(fieldId, fieldPrefixes));
    const fieldIds = matchingFieldIds.slice(0, maxFields);
    const selectedSamples = sourceSamples
      .filter((_, index, all) => index % sampleEvery === 0 || index === all.length - 1);
    const boundedSamples = selectedSamples.length <= MAX_TRAJECTORY_SAMPLES
      ? selectedSamples
      : [...selectedSamples.slice(0, MAX_TRAJECTORY_SAMPLES - 1), selectedSamples.at(-1)];
    const samples = boundedSamples.map((sample) => ({
      time: sample.time,
      values: Object.fromEntries(fieldIds.map((fieldId) => [
        fieldId,
        displayValue(sample.state[fieldId]),
      ])),
    }));
    return {
      schema: SERVICE_SCHEMA,
      worldId,
      candidateId: id,
      canonical: record.status === 'committed',
      retention: record.candidate.path?.retention ?? null,
      fieldIds,
      query: record.candidate.query,
      totalSourceSamples: sourceSamples.length,
      returnedSamples: samples.length,
      samples,
      truncated:
        matchingFieldIds.length > fieldIds.length || selectedSamples.length > samples.length,
    };
  }

  async summarizeTrajectory({
    worldId,
    candidateId: id,
    startTime,
    endTime,
    fields,
    accessScopes = [],
  }) {
    const world = this.getWorld(worldId);
    ensureHandle(id, 'candidateId');
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      throw new Error('startTime and endTime must be finite with endTime after startTime.');
    }
    ensureBoundedStringArray(fields, 'fields', MAX_TRAJECTORY_FIELDS);
    if (fields.length === 0) throw new Error('fields must contain at least one process id.');
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    const summary = await this.backend.call('summarize_trajectory', {
      candidate_hash: this.candidateHash(world, id),
      trajectory_summary: {
        schema: TRAJECTORY_SUMMARY_QUERY_SCHEMA,
        start_time: startTime,
        end_time: endTime,
        fields,
        access_scopes: accessScopes,
      },
    });
    return {
      schema: SERVICE_SCHEMA,
      worldId,
      candidateId: id,
      summary,
      readOnly: true,
      interpolation: 'piecewise-linear-over-retained-samples',
    };
  }

  async acceptCandidate({ worldId, candidateId: id, requestId, expectedParentHash }) {
    const world = this.getWorld(worldId);
    ensureHandle(id, 'candidateId');
    ensureHash(expectedParentHash, 'expectedParentHash');
    return this.#withIdempotentReceipt(
      world.receipts,
      'accept-candidate',
      requestId,
      { worldId, candidateId: id, expectedParentHash },
      async () => {
        const headBefore = await this.backend.call('get_world', { world_id: worldId });
        if (headBefore.world_hash !== expectedParentHash) {
          throw new Error('Expected parent hash does not match the current Rust world head.');
        }
        const hash = this.candidateHash(world, id);
        const result = await this.backend.call('commit_candidate', {
          candidate_hash: hash,
          view: {
            requested_observables: [],
            access_scopes: [],
            include_path: false,
          },
        });
        return {
          schema: SERVICE_SCHEMA,
          worldId,
          candidateId: id,
          acceptedCandidateHash: result.candidate.candidate.candidate_hash,
          priorParentHash: expectedParentHash,
          headHash: result.world_head.world_hash,
          headVersion: result.world_head.version,
          time: result.world_head.time,
          canonical: true,
          candidateStoreChanged: true,
          acceptedHeadChanged: true,
          reusedExisting: false,
          atomicWholeModelCommit: true,
          commitAuthority: 'Rust machine compare-and-swap',
        };
      },
    );
  }

  async annotateCandidate({ worldId, candidateId: id, requestId, verdict, issues = [] }) {
    const world = this.getWorld(worldId);
    this.candidateHash(world, id);
    validateAnnotation({ verdict, issues });
    return this.#withIdempotentReceipt(
      world.receipts,
      'annotate-candidate',
      requestId,
      { worldId, candidateId: id, verdict, issues },
      async () => {
        if (
          world.evaluations.length + world.pendingEvaluations >=
          MAX_EVALUATIONS_PER_WORLD
        ) {
          throw new Error(`Evaluation quota of ${MAX_EVALUATIONS_PER_WORLD} reached.`);
        }
        world.pendingEvaluations += 1;
        try {
          const record = await this.getCandidate(world, id);
          const annotation = {
            id: `evaluation_${randomUUID()}`,
            candidateId: id,
            candidateHash: record.candidate.candidate_hash,
            verdict,
            issues: structuredClone(issues),
            canonicalWorldMutation: false,
          };
          world.evaluations.push(annotation);
          return { schema: SERVICE_SCHEMA, worldId, ...annotation };
        } finally {
          world.pendingEvaluations -= 1;
        }
      },
    );
  }

  async createWriterContract({
    worldId,
    candidateId: id,
    requestId,
    brief,
    fields,
    graph = null,
  }) {
    const world = this.getWorld(worldId);
    this.candidateHash(world, id);
    ensureBoundedNonemptyString(brief, 'brief', MAX_WRITER_BRIEF_LENGTH);
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > MAX_WRITER_FIELDS) {
      throw new Error(`fields must contain between 1 and ${MAX_WRITER_FIELDS} entries.`);
    }
    for (const [index, field] of fields.entries()) {
      if (!isRecord(field)) throw new Error(`fields[${index}] must be an object.`);
      ensureBoundedNonemptyString(
        field.fieldId,
        `fields[${index}].fieldId`,
        MAX_ANNOTATION_FIELD_ID_LENGTH,
      );
    }
    validateAggregateJsonBytes(
      { brief, fields, graph },
      'writer contract input',
      MAX_WRITER_CONTRACT_INPUT_BYTES,
    );
    return this.#withIdempotentReceipt(
      world.receipts,
      'create-writer-contract',
      requestId,
      { worldId, candidateId: id, brief, fields, graph },
      async () => {
        if (
          world.writerContracts.size + world.pendingWriterContracts >=
          MAX_WRITER_CONTRACTS_PER_WORLD
        ) {
          throw new Error(`Writer-contract quota of ${MAX_WRITER_CONTRACTS_PER_WORLD} reached.`);
        }
        world.pendingWriterContracts += 1;
        try {
          const record = await this.getCandidate(world, id);
          if (record.status !== 'committed') {
            throw new Error('Writer contracts may use only a Rust-committed candidate.');
          }
          const beginning = startState(record.candidate);
          if (!beginning) {
            throw new Error(
              'Writer contracts require a candidate path retaining the interval start state.',
            );
          }
          const [head, model] = await Promise.all([
            this.backend.call('get_world', { world_id: worldId }),
            this.backend.call('get_model', { model_hash: world.modelHash }),
          ]);
          const availableFields = Object.keys(record.candidate.successor_state)
            .flatMap((fieldId) => {
              const start = scalar(beginning[fieldId]);
              const end = scalar(record.candidate.successor_state[fieldId]);
              return start === null || end === null ? [] : [{ fieldId, start, end }];
            });
          let graphContext = null;
          if (graph !== null) {
            if (!isRecord(graph)) throw new Error('graph must be an object when supplied.');
            const focusFieldId = graph.focusFieldId ?? fields.find(
              ({ causallyRelevant = true }) => causallyRelevant,
            )?.fieldId ?? fields[0].fieldId;
            ensureBoundedNonemptyString(focusFieldId, 'graph.focusFieldId');
            const graphDepth = graph.depth ?? 2;
            if (
              !Number.isInteger(graphDepth) ||
              graphDepth < 0 ||
              graphDepth > MAX_GRAPH_NEIGHBORHOOD_DEPTH
            ) {
              throw new Error(
                `graph.depth must be an integer from 0 through ${MAX_GRAPH_NEIGHBORHOOD_DEPTH}.`,
              );
            }
            const graphDirection = graph.direction ?? 'both';
            if (!['ancestors', 'descendants', 'both'].includes(graphDirection)) {
              throw new Error('graph.direction must be ancestors, descendants, or both.');
            }
            const graphAccessScopes = graph.accessScopes ?? [];
            ensureBoundedStringArray(
              graphAccessScopes,
              'graph.accessScopes',
              MAX_VIEW_ACCESS_SCOPES,
            );
            const graphSource = { candidate_hash: record.candidate.candidate_hash };
            const globalSkeleton = await this.backend.call('query_graph', {
              ...graphSource,
              graph_query: {
                mode: 'skeleton',
                include_values: false,
                access_scopes: [...new Set(graphAccessScopes)].sort(),
              },
            });
            const activeSlice = await this.backend.call('query_graph', {
              ...graphSource,
              graph_query: {
                mode: 'neighborhood',
                center: `process:${focusFieldId}`,
                depth: graphDepth,
                direction: graphDirection,
                include_values: true,
                access_scopes: [...new Set(graphAccessScopes)].sort(),
                expected_snapshot_hash: globalSkeleton.snapshot_hash,
              },
            });
            graphContext = {
              snapshotHash: globalSkeleton.snapshot_hash,
              globalSkeleton,
              activeSlice,
              wholeGraphAccess: {
                tool: 'life_graph_query',
                mode: 'full',
                source: {
                  kind: 'candidate',
                  candidateHash: record.candidate.candidate_hash,
                },
                accessScopes: [...new Set(graphAccessScopes)].sort(),
                expectedSnapshotHash: globalSkeleton.snapshot_hash,
              },
            };
          }
          const contract = createWriterContract({
            contractId: `writer_contract_${randomUUID()}`,
            worldId,
            sourceCandidateHash: record.candidate.candidate_hash,
            acceptedHeadHash: record.proposed_head.world_hash,
            acceptedHeadVersion: record.proposed_head.version,
            timeUnit: model.summary.time_unit,
            interval: {
              startTime: record.candidate.start_time,
              endTime: record.candidate.end_time,
            },
            brief,
            requestedFields: fields,
            availableFields,
            graphContext,
          });
          const response = { ...contract, currentHeadHash: head.world_hash };
          const retainedReceiptBytes = Buffer.byteLength(canonicalJson({
            ...response,
            requestPayloadHash: '0'.repeat(64),
          }));
          if (retainedReceiptBytes > MAX_STANDARD_RECEIPT_RESULT_BYTES) {
            throw new Error(
              `writer contract result would retain ${retainedReceiptBytes} bytes; ` +
              `receipt limit is ${MAX_STANDARD_RECEIPT_RESULT_BYTES}. ` +
              'Request a smaller graph neighborhood.',
            );
          }
          world.writerContracts.set(contract.contractId, contract);
          return response;
        } finally {
          world.pendingWriterContracts -= 1;
        }
      },
    );
  }

  async evaluateWriterPlan({ worldId, contractId, requestId, dispositions }) {
    const world = this.getWorld(worldId);
    ensureHandle(contractId, 'contractId');
    if (
      !Array.isArray(dispositions) ||
      dispositions.length < 1 ||
      dispositions.length > MAX_WRITER_FIELDS
    ) {
      throw new Error(`dispositions must contain between 1 and ${MAX_WRITER_FIELDS} entries.`);
    }
    for (const [index, disposition] of dispositions.entries()) {
      if (!isRecord(disposition)) {
        throw new Error(`dispositions[${index}] must be an object.`);
      }
      ensureBoundedNonemptyString(
        disposition.fieldId,
        `dispositions[${index}].fieldId`,
        MAX_ANNOTATION_FIELD_ID_LENGTH,
      );
      if (disposition.explanation !== undefined && disposition.explanation !== '') {
        ensureBoundedNonemptyString(
          disposition.explanation,
          `dispositions[${index}].explanation`,
          MAX_WRITER_EXPLANATION_LENGTH,
        );
      }
    }
    validateAggregateJsonBytes(
      dispositions,
      'writer plan input',
      MAX_WRITER_PLAN_INPUT_BYTES,
    );
    return this.#withIdempotentReceipt(
      world.receipts,
      'evaluate-writer-plan',
      requestId,
      { worldId, contractId, dispositions },
      async () => {
        if (
          world.writerPlans.size + world.pendingWriterPlans >=
          MAX_WRITER_PLANS_PER_WORLD
        ) {
          throw new Error(`Writer-plan quota of ${MAX_WRITER_PLANS_PER_WORLD} reached.`);
        }
        const contract = world.writerContracts.get(contractId);
        if (!contract) throw new Error('Unknown or inaccessible writer contract.');
        world.pendingWriterPlans += 1;
        try {
          const head = await this.backend.call('get_world', { world_id: worldId });
          const plan = evaluateWriterPlan({
            planId: `writer_plan_${randomUUID()}`,
            contract,
            dispositions,
            currentHeadHash: head.world_hash,
          });
          world.writerPlans.set(plan.planId, plan);
          return plan;
        } finally {
          world.pendingWriterPlans -= 1;
        }
      },
    );
  }

  async routeCandidates({
    worldId,
    requestId,
    candidateIds,
    terms,
    accessScopes = [],
  }) {
    const world = this.getWorld(worldId);
    ensureRequestId(requestId);
    ensureBoundedStringArray(candidateIds, 'candidateIds', MAX_ROUTE_CANDIDATES);
    ensureBoundedStringArray(accessScopes, 'accessScopes', MAX_VIEW_ACCESS_SCOPES);
    if (candidateIds.length < 2 || new Set(candidateIds).size !== candidateIds.length) {
      throw new Error('candidateIds must contain at least two unique candidates.');
    }
    if (!Array.isArray(terms) || terms.length < 1 || terms.length > MAX_ROUTE_TERMS) {
      throw new Error(`terms must contain between 1 and ${MAX_ROUTE_TERMS} entries.`);
    }
    for (const [index, term] of terms.entries()) {
      if (!isRecord(term)) throw new Error(`terms[${index}] must be an object.`);
      ensureBoundedNonemptyString(term.termId, `terms[${index}].termId`, 256);
      ensureBoundedNonemptyString(term.fieldId, `terms[${index}].fieldId`);
    }
    const requestedObservables = [...new Set(terms.map(({ fieldId }) => fieldId))].sort();
    const includePath = terms.some(({ source }) => source === 'change');
    const [model, ...records] = await Promise.all([
      this.backend.call('get_model', { model_hash: world.modelHash }),
      ...candidateIds.map(async (candidateId) => ({
        candidateId,
        record: await this.backend.call('query_view', {
          candidate_hash: this.candidateHash(world, candidateId),
          view: {
            requested_observables: requestedObservables,
            access_scopes: [...new Set(accessScopes)].sort(),
            include_path: includePath,
          },
        }),
      })),
    ]);
    return routeCandidates({
      routeId: requestId,
      worldId,
      records,
      model: model.model,
      terms,
    });
  }

  async diagnoseStoryRevision(input) {
    validateAggregateJsonBytes(input, 'story revision diagnosis input', MAX_ANNOTATION_BYTES);
    return diagnoseStoryRevision(input);
  }
}

export const serviceLimits = Object.freeze({
  maxWorlds: MAX_WORLDS,
  maxModels: MAX_MODELS,
  maxCandidatesPerWorld: MAX_CANDIDATES_PER_WORLD,
  maxTrajectoryFields: MAX_TRAJECTORY_FIELDS,
  maxTrajectorySamples: MAX_TRAJECTORY_SAMPLES,
  maxViewFields: MAX_VIEW_FIELDS,
  maxViewAccessScopes: MAX_VIEW_ACCESS_SCOPES,
  maxQueryDeltaTime: MAX_QUERY_DELTA_TIME,
  maxQueryStepSize: MAX_QUERY_STEP_SIZE,
  maxQueryProcessReferences: MAX_QUERY_PROCESS_REFERENCES,
  maxQueryInterventions: MAX_QUERY_INTERVENTIONS,
  maxQueryObservations: MAX_QUERY_OBSERVATIONS,
  maxQueryStringLength: MAX_QUERY_STRING_LENGTH,
  maxQueryNestingDepth: MAX_QUERY_NESTING_DEPTH,
  maxRequestIdLength: MAX_REQUEST_ID_LENGTH,
  maxHandleLength: MAX_HANDLE_LENGTH,
  maxPrefixes: MAX_PREFIXES,
  maxPrefixLength: MAX_PREFIX_LENGTH,
  maxAnnotationIssues: MAX_ANNOTATION_ISSUES,
  maxAnnotationFieldIdLength: MAX_ANNOTATION_FIELD_ID_LENGTH,
  maxAnnotationCodeLength: MAX_ANNOTATION_CODE_LENGTH,
  maxAnnotationExplanationLength: MAX_ANNOTATION_EXPLANATION_LENGTH,
  maxAnnotationBytes: MAX_ANNOTATION_BYTES,
  maxWriterContractInputBytes: MAX_WRITER_CONTRACT_INPUT_BYTES,
  maxWriterPlanInputBytes: MAX_WRITER_PLAN_INPUT_BYTES,
  maxGraphNeighborhoodDepth: MAX_GRAPH_NEIGHBORHOOD_DEPTH,
  maxNarrativeGraphBytes: MAX_NARRATIVE_GRAPH_BYTES,
  maxNarrativeRoots: MAX_NARRATIVE_ROOTS,
  maxNarrativeNodes: MAX_NARRATIVE_NODES,
  maxNarrativeEdges: MAX_NARRATIVE_EDGES,
  maxRouteCandidates: MAX_ROUTE_CANDIDATES,
  maxRouteTerms: MAX_ROUTE_TERMS,
  maxModelBytes: MAX_MODEL_BYTES,
  maxModelProcesses: MAX_MODEL_PROCESSES,
  maxModelLaws: MAX_MODEL_LAWS,
  maxModelEdges: MAX_MODEL_EDGES,
  maxModelClaims: MAX_MODEL_CLAIMS,
  maxModelMeaningRecords: MAX_MODEL_MEANING_RECORDS,
  maxProfileSpecs: MAX_PROFILE_SPECS,
  maxMeaningQueryIds: MAX_MEANING_QUERY_IDS,
  maxMeaningQueryItems: MAX_MEANING_QUERY_ITEMS,
  maxMeaningQueryOffset: MAX_MEANING_QUERY_OFFSET,
  maxMeaningQueryDefinitionBytes: MAX_MEANING_QUERY_DEFINITION_BYTES,
  maxReceiptsPerScope: MAX_RECEIPTS_PER_SCOPE,
  maxReceiptBytesGlobal: MAX_RECEIPT_BYTES_GLOBAL,
  maxModelReceiptResultBytes: MAX_MODEL_RECEIPT_RESULT_BYTES,
  maxStandardReceiptResultBytes: MAX_STANDARD_RECEIPT_RESULT_BYTES,
  maxEvaluationsPerWorld: MAX_EVALUATIONS_PER_WORLD,
  maxWriterFields: MAX_WRITER_FIELDS,
  maxWriterContractsPerWorld: MAX_WRITER_CONTRACTS_PER_WORLD,
  maxWriterPlansPerWorld: MAX_WRITER_PLANS_PER_WORLD,
  maxEstimationCoordinates: MAX_ESTIMATION_COORDINATES,
  maxProvisionalClaims: MAX_PROVISIONAL_CLAIMS,
  maxSemanticChanges: MAX_SEMANTIC_CHANGES,
  maxEstimationRequests: MAX_ESTIMATION_REQUESTS,
  maxEstimationProposals: MAX_ESTIMATION_PROPOSALS,
  maxEstimationReviews: MAX_ESTIMATION_REVIEWS,
  maxEstimationContextLength: MAX_ESTIMATION_CONTEXT_LENGTH,
  maxEstimationReasonLength: MAX_ESTIMATION_REASON_LENGTH,
  maxEstimationStorageBytes: MAX_ESTIMATION_STORAGE_BYTES,
  maxEstimationRequestBytes: MAX_ESTIMATION_REQUEST_BYTES,
  maxEstimationProposalBytes: MAX_ESTIMATION_PROPOSAL_BYTES,
  maxEstimationReviewBytes: MAX_ESTIMATION_REVIEW_BYTES,
});
