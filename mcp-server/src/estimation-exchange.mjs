export const estimationOperations = Object.freeze([
  'assimilate',
  'estimate',
  'predict',
  'infer',
  'counterfactual',
  'simulate',
]);

export const estimationIntents = Object.freeze(['reality', 'creative']);
export const estimationDispositions = Object.freeze(['known', 'unknown', 'unmodeled']);
export const estimationOutputModes = Object.freeze([
  'observed',
  'estimated',
  'simulated',
  'derived',
]);
export const estimationReviewVerdicts = Object.freeze([
  'approved',
  'changes_requested',
  'rejected',
]);

export const MAX_ESTIMATION_COORDINATES = 256;
export const MAX_PROVISIONAL_CLAIMS = 256;
export const MAX_SEMANTIC_CHANGES = 512;
export const MAX_ESTIMATION_REQUESTS = 512;
export const MAX_ESTIMATION_PROPOSALS = 64;
export const MAX_ESTIMATION_REVIEWS = 512;
export const MAX_ESTIMATION_CONTEXT_LENGTH = 20_000;
export const MAX_ESTIMATION_REASON_LENGTH = 4_000;
export const MAX_ESTIMATION_STORAGE_BYTES = 32 * 1024 * 1024;
export const MAX_ESTIMATION_REQUEST_BYTES = 192 * 1024;
export const MAX_ESTIMATION_PROPOSAL_BYTES = 9 * 1024 * 1024;
export const MAX_ESTIMATION_REVIEW_BYTES = 64 * 1024;

const REALITY_EVIDENCE_TYPES = new Set([
  'observation',
  'report',
  'belief',
  'estimate',
  'forecast',
]);
const ALL_EVIDENCE_TYPES = new Set([
  ...REALITY_EVIDENCE_TYPES,
  'creative_hypothesis',
  'fictional_canon',
]);
const STRONG_EVIDENCE_TYPES = new Set(['observation', 'report']);
const MODEL_QUERY_SCHEMA = 'life-sim-rust-model-query/v1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
}

function ensureNonemptyString(value, label, maximum = 1_024) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new Error(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
}

function ensureFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
}

function ensureOnlyKeys(value, keys, label) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported field ${unexpected[0]}.`);
  }
}

function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : null);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('Estimation payload must not contain cycles.');
    ancestors.add(value);
    const result = `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`;
    ancestors.delete(value);
    return result;
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) throw new Error('Estimation payload must not contain cycles.');
    ancestors.add(value);
    const result = `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`)
      .join(',')}}`;
    ancestors.delete(value);
    return result;
  }
  throw new Error(`Estimation payload contains unsupported ${typeof value} value.`);
}

export function canonicalEstimationJson(value) {
  return canonicalJson(value);
}

function validateUncertainty(uncertainty, label) {
  ensureRecord(uncertainty, label);
  if (uncertainty.kind === 'exact' || uncertainty.kind === 'unknown') {
    ensureOnlyKeys(uncertainty, ['kind'], label);
    return;
  }
  if (uncertainty.kind === 'standard_deviation') {
    ensureOnlyKeys(uncertainty, ['kind', 'value'], label);
    ensureFinite(uncertainty.value, `${label}.value`);
    if (uncertainty.value < 0) throw new Error(`${label}.value must be nonnegative.`);
    return;
  }
  if (uncertainty.kind === 'interval') {
    ensureOnlyKeys(uncertainty, ['kind', 'lower', 'upper'], label);
    ensureFinite(uncertainty.lower, `${label}.lower`);
    ensureFinite(uncertainty.upper, `${label}.upper`);
    if (uncertainty.upper < uncertainty.lower) {
      throw new Error(`${label} interval must not be reversed.`);
    }
    return;
  }
  throw new Error(`${label}.kind is not a Rust ClaimUncertainty kind.`);
}

function validateStringList(value, label, maximum = 64) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} entries.`);
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    ensureNonemptyString(item, `${label}[${index}]`);
    if (seen.has(item)) throw new Error(`${label} must not repeat ${item}.`);
    seen.add(item);
  }
}

function numericArray(value, label, length = null) {
  if (!Array.isArray(value) || (length !== null && value.length !== length)) {
    throw new Error(`${label} must be a numeric array${length === null ? '' : ` of length ${length}`}.`);
  }
  value.forEach((item, index) => ensureFinite(item, `${label}[${index}]`));
}

export function validateProcessValue(value, process, label = 'claim.value') {
  ensureRecord(value, label);
  const type = process?.value_type;
  ensureRecord(type, 'process.value_type');
  if (value.kind !== type.kind) {
    throw new Error(`${label}.kind must match ${process.id} value type ${type.kind}.`);
  }
  ensureOnlyKeys(value, ['kind', 'value'], label);
  switch (type.kind) {
    case 'scalar': {
      ensureFinite(value.value, `${label}.value`);
      if (value.value < type.bounds.minimum || value.value > type.bounds.maximum) {
        throw new Error(`${label}.value lies outside ${process.id} bounds.`);
      }
      return;
    }
    case 'vector': {
      numericArray(value.value, `${label}.value`, type.dimensions);
      if (value.value.some((item) => item < type.bounds.minimum || item > type.bounds.maximum)) {
        throw new Error(`${label}.value lies outside ${process.id} bounds.`);
      }
      return;
    }
    case 'category':
    case 'regime': {
      if (typeof value.value !== 'string' || !type.variants.includes(value.value)) {
        throw new Error(`${label}.value is not a declared ${process.id} variant.`);
      }
      return;
    }
    case 'distribution': {
      numericArray(value.value, `${label}.value`, type.outcomes.length);
      if (value.value.some((item) => item < 0)) {
        throw new Error(`${label}.value probabilities must be nonnegative.`);
      }
      const total = value.value.reduce((sum, item) => sum + item, 0);
      if (Math.abs(total - 1) > 1e-9) {
        throw new Error(`${label}.value probabilities must sum to one.`);
      }
      return;
    }
    case 'object_pose': {
      ensureRecord(value.value, `${label}.value`);
      ensureOnlyKeys(value.value, ['position', 'orientation'], `${label}.value`);
      numericArray(value.value.position, `${label}.value.position`, type.position_dimensions);
      numericArray(
        value.value.orientation,
        `${label}.value.orientation`,
        type.orientation_dimensions,
      );
      return;
    }
    case 'graph': {
      ensureRecord(value.value, `${label}.value`);
      ensureOnlyKeys(value.value, ['nodes', 'edges'], `${label}.value`);
      validateStringList(value.value.nodes, `${label}.value.nodes`, 10_000);
      if (!Array.isArray(value.value.edges) || value.value.edges.length > 50_000) {
        throw new Error(`${label}.value.edges must be a bounded array.`);
      }
      for (const [index, edge] of value.value.edges.entries()) {
        ensureRecord(edge, `${label}.value.edges[${index}]`);
        ensureOnlyKeys(edge, ['source', 'target', 'relation'], `${label}.value.edges[${index}]`);
        for (const key of ['source', 'target', 'relation']) {
          ensureNonemptyString(edge[key], `${label}.value.edges[${index}].${key}`);
        }
      }
      return;
    }
    default:
      throw new Error(`Unsupported Rust process value type ${type.kind}.`);
  }
}

export function validateEstimationRequestInput({
  operation,
  intent,
  evidenceCutoff,
  coordinates,
  accessScopes,
  context,
}, { headTime, processById }) {
  if (!estimationOperations.includes(operation)) {
    throw new Error('operation is not a supported estimation operation.');
  }
  if (!estimationIntents.includes(intent)) {
    throw new Error('intent must be reality or creative.');
  }
  ensureFinite(evidenceCutoff, 'evidenceCutoff');
  if (evidenceCutoff < headTime) {
    throw new Error(
      'evidenceCutoff cannot precede the accepted head time because Rust does not retain a historical evidence projection for this exchange.',
    );
  }
  if (evidenceCutoff > headTime && operation !== 'assimilate') {
    throw new Error(
      'Only assimilate may declare external evidence after the accepted head time; other operations must use the accepted-head cutoff.',
    );
  }
  if (!Array.isArray(coordinates) || coordinates.length < 1 || coordinates.length > MAX_ESTIMATION_COORDINATES) {
    throw new Error(`coordinates must contain between 1 and ${MAX_ESTIMATION_COORDINATES} entries.`);
  }
  validateStringList(accessScopes, 'accessScopes', 64);
  if (context !== '') ensureNonemptyString(context, 'context', MAX_ESTIMATION_CONTEXT_LENGTH);
  if (['counterfactual', 'simulate'].includes(operation) && context === '') {
    throw new Error(`${operation} requests require bounded context defining the scenario.`);
  }
  const seenIds = new Set();
  const seenTargets = new Set();
  for (const [index, coordinate] of coordinates.entries()) {
    ensureRecord(coordinate, `coordinates[${index}]`);
    ensureOnlyKeys(
      coordinate,
      ['id', 'processId', 'targetTime', 'question'],
      `coordinates[${index}]`,
    );
    ensureNonemptyString(coordinate.id, `coordinates[${index}].id`);
    ensureNonemptyString(coordinate.processId, `coordinates[${index}].processId`);
    if (!processById.has(coordinate.processId)) {
      throw new Error(`coordinates[${index}] references unknown process ${coordinate.processId}.`);
    }
    if (seenIds.has(coordinate.id)) throw new Error(`coordinates repeat id ${coordinate.id}.`);
    seenIds.add(coordinate.id);
    if (coordinate.targetTime !== undefined) {
      ensureFinite(coordinate.targetTime, `coordinates[${index}].targetTime`);
    }
    const targetTime = coordinate.targetTime ?? headTime;
    const targetKey = `${coordinate.processId}\u0000${targetTime}`;
    if (seenTargets.has(targetKey)) {
      throw new Error('coordinates must not repeat the same process and target time.');
    }
    seenTargets.add(targetKey);
    if (coordinate.question !== undefined) {
      ensureNonemptyString(coordinate.question, `coordinates[${index}].question`, 4_000);
    }
    if (operation === 'predict' && targetTime <= headTime) {
      throw new Error('predict coordinates require targetTime after the accepted head time.');
    }
    if (operation === 'assimilate' && targetTime > evidenceCutoff) {
      throw new Error('assimilate coordinates cannot be later than the declared evidence cutoff.');
    }
  }
}

function claimConflicts(existing, incoming, incomingValueTime) {
  const existingValueTime = existing.value_time ?? existing.evidence_cutoff;
  return existing.subject === incoming.subject &&
    existingValueTime === incomingValueTime &&
    canonicalJson(existing.value) !== canonicalJson(incoming.value);
}

function validateClaim(claim, { coordinate, intent, evidenceCutoff, process, existingClaims }, label) {
  ensureRecord(claim, label);
  ensureOnlyKeys(claim, [
    'id',
    'subject',
    'value',
    'uncertainty',
    'evidence_type',
    'holder',
    'evidence_cutoff',
    'provenance',
    'authority',
    'access_scopes',
  ], label);
  ensureNonemptyString(claim.id, `${label}.id`);
  if (claim.subject !== coordinate.processId) {
    throw new Error(`${label}.subject must equal the requested processId.`);
  }
  validateProcessValue(claim.value, process, `${label}.value`);
  validateUncertainty(claim.uncertainty, `${label}.uncertainty`);
  if (!ALL_EVIDENCE_TYPES.has(claim.evidence_type)) {
    throw new Error(`${label}.evidence_type is not a Rust EvidenceType.`);
  }
  if (intent === 'reality' && !REALITY_EVIDENCE_TYPES.has(claim.evidence_type)) {
    throw new Error(`${label} cannot use fictional evidence in reality intent.`);
  }
  ensureNonemptyString(claim.holder, `${label}.holder`);
  ensureFinite(claim.evidence_cutoff, `${label}.evidence_cutoff`);
  if (claim.evidence_cutoff > evidenceCutoff) {
    throw new Error(`${label} uses evidence after the request cutoff.`);
  }
  validateStringList(claim.provenance, `${label}.provenance`, 64);
  if (claim.provenance.length === 0) throw new Error(`${label}.provenance must not be empty.`);
  ensureRecord(claim.authority, `${label}.authority`);
  ensureOnlyKeys(claim.authority, ['source', 'weight'], `${label}.authority`);
  ensureNonemptyString(claim.authority.source, `${label}.authority.source`);
  ensureFinite(claim.authority.weight, `${label}.authority.weight`);
  if (claim.authority.weight < 0 || claim.authority.weight > 1) {
    throw new Error(`${label}.authority.weight must be in [0,1].`);
  }
  validateStringList(claim.access_scopes ?? [], `${label}.access_scopes`, 64);
  if (existingClaims.some((existing) => existing.id === claim.id)) {
    throw new Error(`${label}.id collides with a claim on the accepted world head.`);
  }
}

function meaningRecords(model, collection) {
  const block = model.meaning_model;
  if (block === undefined || block === null) return [];
  const records = block[collection] ?? [];
  return Array.isArray(records) ? records : [];
}

function recordById(model, collection) {
  return new Map(meaningRecords(model, collection).map((record) => [record.id, record]));
}

function validateSemanticChanges(changes, { baseModel, proposedModel, meaningCollections }) {
  if (!Array.isArray(changes) || changes.length > MAX_SEMANTIC_CHANGES) {
    throw new Error(`semanticChanges must contain at most ${MAX_SEMANTIC_CHANGES} entries.`);
  }
  const declared = new Set();
  const allowed = new Set(meaningCollections);
  for (const [index, change] of changes.entries()) {
    const label = `semanticChanges[${index}]`;
    ensureRecord(change, label);
    ensureOnlyKeys(change, ['collection', 'action', 'id', 'definition', 'reason'], label);
    if (!allowed.has(change.collection)) throw new Error(`${label}.collection is unsupported.`);
    if (!['add', 'replace', 'remove'].includes(change.action)) {
      throw new Error(`${label}.action must be add, replace, or remove.`);
    }
    ensureNonemptyString(change.id, `${label}.id`);
    ensureNonemptyString(change.reason, `${label}.reason`, MAX_ESTIMATION_REASON_LENGTH);
    const key = `${change.collection}\u0000${change.id}`;
    if (declared.has(key)) throw new Error(`semanticChanges repeat ${change.id}.`);
    declared.add(key);
    const before = recordById(baseModel, change.collection).get(change.id);
    const after = recordById(proposedModel, change.collection).get(change.id);
    if (change.action === 'add') {
      if (before !== undefined || after === undefined) {
        throw new Error(`${label} does not describe an addition.`);
      }
    } else if (change.action === 'replace') {
      if (before === undefined || after === undefined || canonicalJson(before) === canonicalJson(after)) {
        throw new Error(`${label} does not describe a replacement.`);
      }
    } else if (before === undefined || after !== undefined) {
      throw new Error(`${label} does not describe a removal.`);
    }
    if (change.action === 'remove') {
      if (change.definition !== undefined) {
        throw new Error(`${label}.definition must be omitted for removal.`);
      }
    } else {
      ensureRecord(change.definition, `${label}.definition`);
      if (change.definition.id !== change.id || canonicalJson(change.definition) !== canonicalJson(after)) {
        throw new Error(`${label}.definition must exactly equal the proposed model record.`);
      }
    }
  }

  for (const collection of meaningCollections) {
    const before = recordById(baseModel, collection);
    const after = recordById(proposedModel, collection);
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (canonicalJson(before.get(id) ?? null) !== canonicalJson(after.get(id) ?? null)) {
        const key = `${collection}\u0000${id}`;
        if (!declared.has(key)) {
          throw new Error(`Meaning Model change ${collection}/${id} was not declared.`);
        }
      }
    }
  }
}

export function validateEstimationResponseInput({
  dispositions,
  provisionalClaims,
  semanticChanges,
  proposedModel,
  proposalReason,
}, {
  request,
  baseModel,
  worldProjection,
  meaningCollections,
}) {
  if (!Array.isArray(dispositions) || dispositions.length !== request.coordinates.length) {
    throw new Error('dispositions must cover every requested coordinate exactly once.');
  }
  if (!Array.isArray(provisionalClaims) || provisionalClaims.length > MAX_PROVISIONAL_CLAIMS) {
    throw new Error(`provisionalClaims must contain at most ${MAX_PROVISIONAL_CLAIMS} entries.`);
  }
  if (!Array.isArray(semanticChanges) || semanticChanges.length > MAX_SEMANTIC_CHANGES) {
    throw new Error(`semanticChanges must contain at most ${MAX_SEMANTIC_CHANGES} entries.`);
  }
  const hasProposedModel = proposedModel !== undefined && proposedModel !== null;
  if (semanticChanges.length > 0 && !hasProposedModel) {
    throw new Error(
      'semanticChanges require a complete proposedModel successor revision.',
    );
  }
  if (proposalReason !== undefined && proposalReason !== null) {
    ensureNonemptyString(proposalReason, 'proposalReason', MAX_ESTIMATION_REASON_LENGTH);
  }
  if (hasProposedModel && (proposalReason === undefined || proposalReason === null)) {
    throw new Error('proposedModel requires proposalReason.');
  }
  const coordinateById = new Map(request.coordinates.map((coordinate) => [coordinate.id, coordinate]));
  const processById = new Map(baseModel.processes.map((process) => [process.id, process]));
  const claimByCoordinate = new Map();
  const claimIds = new Set();
  const existingClaims = Object.values(worldProjection.claims ?? {});
  for (const [index, entry] of provisionalClaims.entries()) {
    const label = `provisionalClaims[${index}]`;
    ensureRecord(entry, label);
    ensureOnlyKeys(
      entry,
      ['coordinateId', 'outputMode', 'valueTime', 'claim', 'acknowledgedClaimIds'],
      label,
    );
    ensureNonemptyString(entry.coordinateId, `${label}.coordinateId`);
    const coordinate = coordinateById.get(entry.coordinateId);
    if (!coordinate) throw new Error(`${label} references an unrequested coordinate.`);
    if (claimByCoordinate.has(entry.coordinateId)) {
      throw new Error(`provisionalClaims repeat coordinate ${entry.coordinateId}.`);
    }
    if (!estimationOutputModes.includes(entry.outputMode)) {
      throw new Error(`${label}.outputMode must be observed, estimated, simulated, or derived.`);
    }
    ensureFinite(entry.valueTime, `${label}.valueTime`);
    const requestedValueTime = coordinate.targetTime ?? request.acceptedHeadTime;
    if (entry.valueTime !== requestedValueTime) {
      throw new Error(`${label}.valueTime must equal the coordinate target time.`);
    }
    const process = processById.get(coordinate.processId);
    if (entry.outputMode === 'observed' && process.update_mode !== 'observed') {
      throw new Error(
        `${label} can use observed mode only for a process with update_mode observed.`,
      );
    }
    validateClaim(entry.claim, {
      coordinate,
      intent: request.intent,
      evidenceCutoff: request.evidenceCutoff,
      process,
      existingClaims,
    }, `${label}.claim`);
    if (
      entry.outputMode === 'observed' &&
      !['observation', 'report'].includes(entry.claim.evidence_type)
    ) {
      throw new Error(`${label} observed output requires observation or report evidence.`);
    }
    if (
      entry.outputMode === 'observed' &&
      entry.claim.evidence_cutoff !== entry.valueTime
    ) {
      throw new Error(`${label} observed output requires evidence_cutoff equal to valueTime.`);
    }
    if (
      entry.outputMode === 'observed' &&
      canonicalJson([...(entry.claim.access_scopes ?? [])].sort()) !==
        canonicalJson([...(process.access_scopes ?? [])].sort())
    ) {
      throw new Error(
        `${label} observed output access scopes must exactly match the target process scopes.`,
      );
    }
    if (
      entry.outputMode === 'estimated' &&
      !['belief', 'estimate', 'forecast'].includes(entry.claim.evidence_type)
    ) {
      throw new Error(`${label} estimated output requires belief, estimate, or forecast evidence.`);
    }
    if (claimIds.has(entry.claim.id)) throw new Error(`provisionalClaims repeat claim id ${entry.claim.id}.`);
    claimIds.add(entry.claim.id);
    validateStringList(
      entry.acknowledgedClaimIds ?? [],
      `${label}.acknowledgedClaimIds`,
      MAX_PROVISIONAL_CLAIMS,
    );
    const acknowledged = new Set(entry.acknowledgedClaimIds ?? []);
    const strongConflicts = existingClaims.filter((existing) =>
      STRONG_EVIDENCE_TYPES.has(existing.evidence_type) &&
      claimConflicts(existing, entry.claim, entry.valueTime));
    const missing = strongConflicts.filter((claim) => !acknowledged.has(claim.id));
    if (missing.length > 0) {
      throw new Error(
        `${label} conflicts with stronger accepted claim ${missing[0].id}; acknowledge it explicitly.`,
      );
    }
    const unknownAcknowledgements = [...acknowledged].filter((id) =>
      !existingClaims.some((claim) => claim.id === id));
    if (unknownAcknowledgements.length > 0) {
      throw new Error(`${label} acknowledges unknown accepted claim ${unknownAcknowledgements[0]}.`);
    }
    claimByCoordinate.set(entry.coordinateId, entry);
  }

  const seenCoordinates = new Set();
  for (const [index, disposition] of dispositions.entries()) {
    const label = `dispositions[${index}]`;
    ensureRecord(disposition, label);
    ensureOnlyKeys(disposition, ['coordinateId', 'status', 'reason'], label);
    ensureNonemptyString(disposition.coordinateId, `${label}.coordinateId`);
    if (!coordinateById.has(disposition.coordinateId)) {
      throw new Error(`${label} references an unrequested coordinate.`);
    }
    if (seenCoordinates.has(disposition.coordinateId)) {
      throw new Error(`dispositions repeat coordinate ${disposition.coordinateId}.`);
    }
    seenCoordinates.add(disposition.coordinateId);
    if (!estimationDispositions.includes(disposition.status)) {
      throw new Error(`${label}.status must be known, unknown, or unmodeled.`);
    }
    ensureNonemptyString(disposition.reason, `${label}.reason`, MAX_ESTIMATION_REASON_LENGTH);
    const hasClaim = claimByCoordinate.has(disposition.coordinateId);
    if ((disposition.status === 'known') !== hasClaim) {
      throw new Error(
        `${label} known status requires exactly one provisional claim; unknown/unmodeled forbids one.`,
      );
    }
  }

  if (hasProposedModel) {
    if (!isRecord(proposedModel)) {
      throw new Error('proposedModel must be a complete model object.');
    }
    if (proposedModel.revision?.previous_model_hash !== request.modelHash) {
      throw new Error('proposedModel must link revision.previous_model_hash to the request model.');
    }
    if (proposedModel.revision.number !== request.modelRevision + 1) {
      throw new Error('proposedModel revision number must be exactly one after the request model.');
    }
    if (proposedModel.id !== baseModel.id || proposedModel.time_unit !== baseModel.time_unit) {
      throw new Error('proposedModel must preserve the model identity and time unit.');
    }
    if (
      canonicalJson(proposedModel.initial_claims ?? []) !==
      canonicalJson(baseModel.initial_claims ?? [])
    ) {
      throw new Error(
        'Estimation proposals must preserve initial_claims; provisional current-time claims remain separate until an explicit Rust transition or authored epistemic-law revision handles them.',
      );
    }
    validateSemanticChanges(semanticChanges, { baseModel, proposedModel, meaningCollections });
  }
  return {
    modelProposalIncluded: hasProposedModel,
    strongerClaimConflicts: provisionalClaims.flatMap((entry) =>
      existingClaims
        .filter((existing) =>
          STRONG_EVIDENCE_TYPES.has(existing.evidence_type) &&
          claimConflicts(existing, entry.claim, entry.valueTime))
        .map((existing) => ({
          coordinateId: entry.coordinateId,
          acceptedClaimId: existing.id,
          acceptedEvidenceType: existing.evidence_type,
          acknowledged: true,
          overwritePerformed: false,
        }))),
  };
}

/**
 * Compile reviewed provider output into the exact Rust observation fragment.
 * This is deliberately a plan only: it never calls Rust and cannot advance a
 * world. Current/past values remain blocked because the Rust transition field
 * accepts only positive forward offsets from its frozen parent.
 */
export function buildObservationMaterializationPlan({
  request,
  provisionalClaims,
  baseModel,
}) {
  const observed = provisionalClaims.filter(({ outputMode }) => outputMode === 'observed');
  if (observed.length === 0) return { status: 'not_requested' };
  const processById = new Map(baseModel.processes.map((process) => [process.id, process]));
  const blockedOutputs = [];
  const observations = [];
  let maximumOffset = 0;

  for (const entry of observed) {
    const process = processById.get(entry.claim.subject);
    const offset = entry.valueTime - request.acceptedHeadTime;
    if (!(offset > 0)) {
      blockedOutputs.push({
        coordinateId: entry.coordinateId,
        processId: entry.claim.subject,
        valueTime: entry.valueTime,
        acceptedHeadTime: request.acceptedHeadTime,
        offset,
        reason:
          offset === 0
            ? 'Rust observations cannot replace the frozen parent at offset zero.'
            : 'Rust observations cannot append historical values before the frozen parent.',
      });
      continue;
    }
    maximumOffset = Math.max(maximumOffset, offset);
    observations.push({
      id: entry.claim.id,
      target: entry.claim.subject,
      offset,
      value: structuredClone(entry.claim.value),
      unit: process.unit ?? null,
      uncertainty: structuredClone(entry.claim.uncertainty),
      evidence_type: entry.claim.evidence_type,
      holder: entry.claim.holder,
      provenance: structuredClone(entry.claim.provenance),
      authority: structuredClone(entry.claim.authority),
    });
  }

  const common = {
    schema: 'life-sim-mcp-observation-materialization-plan/v1',
    rustAuthority: 'ModelTransitionSpec.observations',
    modelHash: request.modelHash,
    worldId: request.worldId,
    acceptedHeadHash: request.acceptedHeadHash,
    acceptedHeadVersion: request.acceptedHeadVersion,
    acceptedHeadTime: request.acceptedHeadTime,
    observationCount: observed.length,
    materializationPerformed: false,
    modelRegistrationPerformed: false,
    worldMutationPerformed: false,
    currentOrHistoricalAppendSupported: false,
    requirements: {
      offsetRule: 'offset = valueTime - acceptedHeadTime and must be strictly positive',
      forwardOnly: true,
      callerChooses: ['delta_time', 'step_size', 'path', 'seed', 'requestId'],
      deltaTimeRule: 'delta_time must be at least the largest observation offset',
      exactStepRule:
        'step_count = ceil(delta_time / step_size), actual_step = delta_time / step_count, and every offset / actual_step must be a positive integer within Rust tolerance',
      pathModes: ['endpoint', 'full', 'decimated'],
      candidateBoundary:
        'life_candidate_roll creates an uncommitted candidate; inspect it before a separate explicit life_candidate_accept call',
      stalenessBoundary:
        'the roll must still start from this exact accepted head; any head change invalidates the plan',
    },
  };

  if (blockedOutputs.length > 0) {
    return {
      ...common,
      status: 'blocked_current_or_historical_values',
      materializableObservationCount: observations.length,
      blockedOutputs,
      queryFragment: null,
      note:
        'No partial query fragment is returned: excluding blocked observations would silently change the approved proposal.',
    };
  }

  const requestedObservables = [...new Set(observations.map(({ target }) => target))].sort();
  return {
    ...common,
    status: 'ready',
    materializableObservationCount: observations.length,
    maximumOffset,
    blockedOutputs: [],
    queryFragment: {
      schema: MODEL_QUERY_SCHEMA,
      direction: 'forward',
      interventions: [],
      observations,
      selected_support: [],
      requested_observables: requestedObservables,
      access_scopes: structuredClone(request.accessScopes),
    },
    explicitNextSteps: [
      {
        tool: 'life_candidate_roll',
        action:
          'Merge the query fragment with caller-chosen delta_time, step_size, path, and optional seed; supply a fresh requestId.',
      },
      {
        tool: 'life_candidate_accept',
        action:
          'After inspecting the pending candidate, explicitly commit it with a separate fresh requestId.',
      },
    ],
  };
}

export function validateEstimationReviewInput({ verdict, rationale }) {
  if (!estimationReviewVerdicts.includes(verdict)) {
    throw new Error('verdict must be approved, changes_requested, or rejected.');
  }
  ensureNonemptyString(rationale, 'rationale', MAX_ESTIMATION_REASON_LENGTH);
}
