import { createHash } from 'node:crypto';

export const FIELD_STATUSES = Object.freeze([
  'hard',
  'soft',
  'optional',
  'renegotiable',
]);

export const WRITER_DISPOSITIONS = Object.freeze([
  'explicit_dramatization',
  'implicit_adherence',
  'omit_surface_prose',
  'conflict_detected',
  'request_profile_revision',
]);

export const WRITER_REMEDIATION_POLICY = Object.freeze({
  badWording: 'rerender_same_canon',
  excessiveState: 'hide_redundant_soft_fields',
  implausibleDynamics: 'revise_profile_and_rerun',
  uninterestingRandomFuture: 'whole_reroll_from_same_frozen_parent',
  incompatibleAcceptedHistory: 'fork_before_conflict_and_resimulate',
});

export const MAX_WRITER_FIELDS = 100;
export const MAX_EXPLANATION_LENGTH = 2_000;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function validateString(value, label, maximum = MAX_EXPLANATION_LENGTH) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
}

function exactIds(records, expectedIds, label) {
  if (!Array.isArray(records) || records.length !== expectedIds.length) {
    throw new Error(`${label} must cover every writer-contract field exactly once.`);
  }
  const ids = records.map(({ fieldId }) => fieldId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} fieldIds must be unique.`);
  }
  const actual = [...ids].sort();
  const expected = [...expectedIds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must cover every writer-contract field exactly once.`);
  }
}

function normalizeGraphContext(graphContext) {
  if (graphContext === null || graphContext === undefined) return null;
  if (!graphContext || typeof graphContext !== 'object' || Array.isArray(graphContext)) {
    throw new Error('Writer graphContext must be an object.');
  }
  const digest = /^[a-f0-9]{64}$/u;
  if (!digest.test(graphContext.snapshotHash)) {
    throw new Error('Writer graphContext requires a Rust snapshotHash.');
  }
  const skeleton = graphContext.globalSkeleton;
  if (
    skeleton?.schema !== 'life-sim-rust-graph/v1' ||
    skeleton.mode !== 'skeleton' ||
    skeleton.snapshot_hash !== graphContext.snapshotHash ||
    !skeleton.skeleton ||
    typeof skeleton.skeleton !== 'object' ||
    Array.isArray(skeleton.skeleton)
  ) {
    throw new Error('Writer graphContext requires a matching Rust graph skeleton.');
  }
  const activeSlice = graphContext.activeSlice ?? null;
  if (
    activeSlice !== null &&
    (
      activeSlice?.schema !== 'life-sim-rust-graph/v1' ||
      activeSlice.mode !== 'neighborhood' ||
      activeSlice.snapshot_hash !== graphContext.snapshotHash ||
      !activeSlice.neighborhood ||
      typeof activeSlice.neighborhood !== 'object' ||
      Array.isArray(activeSlice.neighborhood) ||
      !Number.isInteger(activeSlice.neighborhood.crossing_edge_count) ||
      activeSlice.neighborhood.crossing_edge_count < 0
    )
  ) {
    throw new Error('Writer graphContext activeSlice must match the skeleton snapshot.');
  }
  const access = graphContext.wholeGraphAccess;
  if (
    access?.tool !== 'life_graph_query' ||
    access?.mode !== 'full' ||
    !access?.source ||
    typeof access.source !== 'object' ||
    Array.isArray(access.source) ||
    access.expectedSnapshotHash !== graphContext.snapshotHash
  ) {
    throw new Error('Writer graphContext must preserve a whole-graph expansion route.');
  }
  return structuredClone({
    snapshotHash: graphContext.snapshotHash,
    globalSkeleton: skeleton,
    activeSlice,
    wholeGraphAccess: access,
    invariants: {
      canonicalGraphRemainsInRust: true,
      skeletonAlwaysAvailable: true,
      activeSliceIsAProjection: true,
      crossingEdgesPreserved: activeSlice === null ? null : true,
      closingDetailDeletesCanon: false,
    },
  });
}

export function createWriterContract({
  contractId,
  worldId,
  sourceCandidateHash,
  acceptedHeadHash,
  acceptedHeadVersion,
  timeUnit,
  interval,
  brief,
  requestedFields,
  availableFields,
  graphContext = null,
}) {
  validateString(contractId, 'contractId', 200);
  validateString(worldId, 'worldId', 200);
  validateString(sourceCandidateHash, 'sourceCandidateHash', 200);
  validateString(acceptedHeadHash, 'acceptedHeadHash', 200);
  validateString(brief, 'brief', 10_000);
  if (
    !Number.isInteger(acceptedHeadVersion) ||
    acceptedHeadVersion < 1 ||
    !Number.isFinite(interval?.startTime) ||
    !Number.isFinite(interval?.endTime) ||
    interval.endTime <= interval.startTime
  ) {
    throw new Error('Writer contract requires a valid accepted head and source interval.');
  }
  if (
    !Array.isArray(requestedFields) ||
    requestedFields.length < 1 ||
    requestedFields.length > MAX_WRITER_FIELDS
  ) {
    throw new Error(`Writer contract needs between 1 and ${MAX_WRITER_FIELDS} fields.`);
  }
  const available = new Map(availableFields.map((field) => [field.fieldId, field]));
  const seen = new Set();
  const fields = requestedFields.map(({ fieldId, status, causallyRelevant = true }) => {
    if (seen.has(fieldId)) throw new Error(`Writer field ${fieldId} is duplicated.`);
    seen.add(fieldId);
    const source = available.get(fieldId);
    if (!source) throw new Error(`Unknown or unavailable accepted field ${fieldId}.`);
    if (!FIELD_STATUSES.includes(status)) {
      throw new Error(`Writer field ${fieldId} has unsupported status ${status}.`);
    }
    if (typeof causallyRelevant !== 'boolean') {
      throw new Error(`Writer field ${fieldId} causallyRelevant must be boolean.`);
    }
    return {
      fieldId,
      status,
      causallyRelevant,
      start: source.start,
      end: source.end,
      change: source.end - source.start,
    };
  });
  const normalizedGraphContext = normalizeGraphContext(graphContext);
  const contract = {
    schema: normalizedGraphContext === null
      ? 'life-sim-writer-contract/v1'
      : 'life-sim-writer-contract/v2',
    contractId,
    authority: {
      canonicalSource: true,
      sourceCandidateHash,
      acceptedHeadHash,
      acceptedHeadVersion,
      canonicalWorldMutation: false,
    },
    worldId,
    brief,
    interval: { ...interval, timeUnit },
    fields,
    ...(normalizedGraphContext === null ? {} : { graphContext: normalizedGraphContext }),
    dispositionVocabulary: [...WRITER_DISPOSITIONS],
    rules: {
      hardRelevantFieldsRequireAdherence: true,
      acceptedAdherenceDispositions: ['explicit_dramatization', 'implicit_adherence'],
      conflictsBlockRendering: true,
      reviseOnlyForRenegotiableFields: true,
      revisionRequiresModelRevisionAndRerun: true,
      canonMayNotBeMutatedByWriterPlanning: true,
      graphSliceMayNotReplaceCanonicalGraph: true,
    },
    remediationPolicy: { ...WRITER_REMEDIATION_POLICY },
  };
  contract.contractHash = hash(contract);
  return Object.freeze(contract);
}

export function evaluateWriterPlan({
  planId,
  contract,
  dispositions,
  currentHeadHash,
}) {
  validateString(planId, 'planId', 200);
  if (
    !['life-sim-writer-contract/v1', 'life-sim-writer-contract/v2'].includes(contract?.schema) ||
    typeof contract.contractHash !== 'string'
  ) {
    throw new Error('Writer plan requires a valid writer contract.');
  }
  const contractPayload = structuredClone(contract);
  delete contractPayload.contractHash;
  if (hash(contractPayload) !== contract.contractHash) {
    throw new Error('Writer contract hash is stale.');
  }
  validateString(currentHeadHash, 'currentHeadHash', 200);
  exactIds(dispositions, contract.fields.map(({ fieldId }) => fieldId), 'Writer dispositions');
  const constraintById = new Map(contract.fields.map((field) => [field.fieldId, field]));
  const blockers = [];
  const revisionRequests = [];
  const normalized = dispositions.map(({ fieldId, disposition, explanation = '' }) => {
    const constraint = constraintById.get(fieldId);
    if (!WRITER_DISPOSITIONS.includes(disposition)) {
      throw new Error(`Writer field ${fieldId} has unsupported disposition ${disposition}.`);
    }
    if (typeof explanation !== 'string' || explanation.length > MAX_EXPLANATION_LENGTH) {
      throw new Error(
        `Writer field ${fieldId} explanation must be at most ${MAX_EXPLANATION_LENGTH} characters.`,
      );
    }
    if (disposition === 'request_profile_revision' && constraint.status !== 'renegotiable') {
      blockers.push({
        fieldId,
        code: 'revision-not-permitted',
        explanation: 'Only a renegotiable field may request profile revision and rerun.',
      });
    }
    if (
      constraint.status === 'hard' &&
      constraint.causallyRelevant &&
      !['explicit_dramatization', 'implicit_adherence'].includes(disposition)
    ) {
      blockers.push({
        fieldId,
        code:
          disposition === 'omit_surface_prose'
            ? 'hard-field-omitted'
            : 'hard-field-not-adhered',
        explanation:
          'A causally relevant hard field must be explicitly dramatized or implicitly adhered to.',
      });
    }
    if (disposition === 'conflict_detected') {
      blockers.push({
        fieldId,
        code: 'writer-conflict',
        explanation: 'A declared conflict must be resolved before rendering can proceed.',
      });
    }
    if (disposition === 'request_profile_revision' && constraint.status === 'renegotiable') {
      revisionRequests.push({
        fieldId,
        action: 'revise-model-and-rerun-from-source-parent',
        sourceCandidateHash: contract.authority.sourceCandidateHash,
        acceptedHeadHashAtContractCreation: contract.authority.acceptedHeadHash,
        currentHeadHash,
        canonMutationAuthorized: false,
        explanation: explanation || 'Writer requested a different trajectory or function.',
      });
    }
    return { fieldId, disposition, explanation };
  });
  if (revisionRequests.length > 0) {
    blockers.push({
      fieldId: null,
      code: 'model-revision-and-rerun-required',
      explanation:
        'Renegotiation creates a revision request; it does not rewrite the accepted candidate.',
    });
  }
  const plan = {
    schema: 'life-sim-writer-plan/v1',
    planId,
    contractId: contract.contractId,
    contractHash: contract.contractHash,
    worldId: contract.worldId,
    sourceCandidateHash: contract.authority.sourceCandidateHash,
    dispositions: normalized,
    blockers,
    revisionRequests,
    renderable: blockers.length === 0,
    actionGuidance: { ...WRITER_REMEDIATION_POLICY },
    canonicalWorldMutation: false,
    headHashBefore: currentHeadHash,
    headHashAfter: currentHeadHash,
  };
  plan.planHash = hash(plan);
  return Object.freeze(plan);
}
