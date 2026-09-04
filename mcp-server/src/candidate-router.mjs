import { createHash } from 'node:crypto';

export const ROUTE_SOURCES = Object.freeze(['endpoint', 'change']);
export const ROUTE_PREFERENCES = Object.freeze(['maximize', 'minimize', 'target']);
export const MAX_ROUTE_CANDIDATES = 64;
export const MAX_ROUTE_TERMS = 100;

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

function scalar(value) {
  return value?.kind === 'scalar' && Number.isFinite(value.value) ? value.value : null;
}

function firstState(candidate) {
  const first = candidate?.path?.samples?.[0];
  return first?.time === candidate?.start_time ? first.state : null;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function validateText(value, label, maximum = 1_024) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
}

function scalarBounds(model) {
  const definition = model?.model ?? model;
  if (!Array.isArray(definition?.processes)) {
    throw new Error('Candidate routing requires the complete registered model definition.');
  }
  return new Map(definition.processes.flatMap((process) => {
    const bounds = process?.value_type?.kind === 'scalar'
      ? process.value_type.bounds
      : null;
    if (
      typeof process?.id !== 'string' ||
      !Number.isFinite(bounds?.minimum) ||
      !Number.isFinite(bounds?.maximum) ||
      bounds.maximum <= bounds.minimum
    ) return [];
    return [[process.id, { minimum: bounds.minimum, maximum: bounds.maximum }]];
  }));
}

function normalizeTerms(terms, boundsById) {
  if (!Array.isArray(terms) || terms.length < 1 || terms.length > MAX_ROUTE_TERMS) {
    throw new Error(`terms must contain between 1 and ${MAX_ROUTE_TERMS} entries.`);
  }
  const seen = new Set();
  let totalWeight = 0;
  const normalized = terms.map((term, index) => {
    if (!term || typeof term !== 'object' || Array.isArray(term)) {
      throw new Error(`terms[${index}] must be an object.`);
    }
    validateText(term.termId, `terms[${index}].termId`, 256);
    validateText(term.fieldId, `terms[${index}].fieldId`);
    if (seen.has(term.termId)) throw new Error(`Duplicate route term ${term.termId}.`);
    seen.add(term.termId);
    if (!ROUTE_SOURCES.includes(term.source)) {
      throw new Error(`Route term ${term.termId} has unsupported source ${term.source}.`);
    }
    if (!ROUTE_PREFERENCES.includes(term.preference)) {
      throw new Error(
        `Route term ${term.termId} has unsupported preference ${term.preference}.`,
      );
    }
    if (!Number.isFinite(term.weight) || term.weight <= 0 || term.weight > 1_000) {
      throw new Error(`Route term ${term.termId} weight must be in (0, 1000].`);
    }
    const bounds = boundsById.get(term.fieldId);
    if (!bounds) {
      throw new Error(`Route term ${term.termId} names a non-scalar or unknown field.`);
    }
    if (term.preference === 'target' && !Number.isFinite(term.target)) {
      throw new Error(`Target route term ${term.termId} requires a finite target.`);
    }
    totalWeight += term.weight;
    return {
      termId: term.termId,
      fieldId: term.fieldId,
      source: term.source,
      preference: term.preference,
      weight: term.weight,
      ...(term.preference === 'target' ? { target: term.target } : {}),
      bounds,
    };
  });
  return normalized.map((term) => ({ ...term, normalizedWeight: term.weight / totalWeight }));
}

function termValue(candidate, term) {
  const endpoint = scalar(candidate.successor_state?.[term.fieldId]);
  if (endpoint === null) {
    throw new Error(`Candidate ${candidate.candidate_hash} lacks scalar ${term.fieldId}.`);
  }
  if (term.source === 'endpoint') return endpoint;
  const beginning = firstState(candidate);
  const start = scalar(beginning?.[term.fieldId]);
  if (start === null) {
    throw new Error(
      `Candidate ${candidate.candidate_hash} must retain its interval start for change term ${term.termId}.`,
    );
  }
  return endpoint - start;
}

function preferenceScore(value, term) {
  const width = term.bounds.maximum - term.bounds.minimum;
  const normalized = term.source === 'endpoint'
    ? clamp01((value - term.bounds.minimum) / width)
    : clamp01((value / width + 1) / 2);
  if (term.preference === 'maximize') return normalized;
  if (term.preference === 'minimize') return 1 - normalized;
  return 1 - Math.min(1, Math.abs(value - term.target) / width);
}

/**
 * Ranks complete Rust candidates using declared scalar character/world state.
 * This is a read-only Director aid. It neither decides for an actor nor accepts
 * a candidate into canon.
 */
export function routeCandidates({ routeId, worldId, records, model, terms }) {
  validateText(routeId, 'routeId', 256);
  validateText(worldId, 'worldId', 256);
  if (
    !Array.isArray(records) || records.length < 2 || records.length > MAX_ROUTE_CANDIDATES
  ) {
    throw new Error(
      `Candidate routing requires between 2 and ${MAX_ROUTE_CANDIDATES} candidates.`,
    );
  }
  const candidateIds = new Set();
  for (const [index, item] of records.entries()) {
    validateText(item?.candidateId, `records[${index}].candidateId`, 256);
    if (candidateIds.has(item.candidateId)) {
      throw new Error(`Candidate ${item.candidateId} is duplicated.`);
    }
    candidateIds.add(item.candidateId);
    if (item.record?.status !== 'pending' || !item.record?.candidate) {
      throw new Error(`Candidate ${item.candidateId} must be a pending complete candidate.`);
    }
  }
  const boundsById = scalarBounds(model);
  const normalizedTerms = normalizeTerms(terms, boundsById);
  const [first] = records;
  const reference = first.record.candidate;
  for (const { candidateId, record } of records.slice(1)) {
    const candidate = record.candidate;
    if (
      candidate.model_hash !== reference.model_hash ||
      candidate.parent_world_hash !== reference.parent_world_hash ||
      candidate.expected_parent_version !== reference.expected_parent_version ||
      candidate.start_time !== reference.start_time ||
      candidate.end_time !== reference.end_time ||
      candidate.dynamics_hash !== reference.dynamics_hash
    ) {
      throw new Error(
        `Candidate ${candidateId} does not share the same model, frozen parent, interval, and dynamics.`,
      );
    }
  }

  const ranking = records.map(({ candidateId, record }) => {
    const candidate = record.candidate;
    const contributions = normalizedTerms.map((term) => {
      const value = termValue(candidate, term);
      const preference = preferenceScore(value, term);
      return {
        termId: term.termId,
        fieldId: term.fieldId,
        source: term.source,
        preference: term.preference,
        value,
        ...(term.preference === 'target' ? { target: term.target } : {}),
        preferenceScore: Number(preference.toFixed(12)),
        normalizedWeight: Number(term.normalizedWeight.toFixed(12)),
        contribution: Number((preference * term.normalizedWeight).toFixed(12)),
      };
    });
    const score = contributions.reduce((total, term) => total + term.contribution, 0);
    return {
      candidateId,
      candidateHash: candidate.candidate_hash,
      score: Number(score.toFixed(12)),
      contributions,
    };
  }).sort((left, right) => (
    right.score - left.score || left.candidateHash.localeCompare(right.candidateHash)
  ));

  const result = {
    schema: 'life-sim-candidate-route/v1',
    routeId,
    worldId,
    modelHash: reference.model_hash,
    frozenParent: {
      worldHash: reference.parent_world_hash,
      version: reference.expected_parent_version,
      time: reference.start_time,
    },
    comparedTransition: {
      endTime: reference.end_time,
      dynamicsHash: reference.dynamics_hash,
    },
    terms: normalizedTerms.map(({ bounds, ...term }) => ({ ...term, bounds })),
    ranking,
    recommendation: {
      candidateId: ranking[0].candidateId,
      candidateHash: ranking[0].candidateHash,
      advisoryOnly: true,
    },
    authority: {
      source: 'scope-checked projections of authoritative Rust candidates',
      declaredScalarStateUsed: true,
      canonicalWorldMutation: false,
      actorSelectionAuthorityClaimed: false,
      automaticAcceptance: false,
    },
  };
  result.routeHash = hash(result);
  return Object.freeze(result);
}
