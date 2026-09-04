import { createHash } from 'node:crypto';

export const STORY_REVISION_LAYERS = Object.freeze([
  'model',
  'cut',
  'trajectory',
  'rendering',
  'undetermined',
]);

export const STORY_REVISION_EVIDENCE_STATUSES = Object.freeze([
  'sufficient',
  'insufficient',
  'unknown',
]);

export const STORY_OBSERVATION_STATUSES = Object.freeze([
  'reader_report',
  'mechanical_observation',
]);

const DIAGNOSABLE_LAYERS = STORY_REVISION_LAYERS.filter(
  (layer) => layer !== 'undetermined',
);
const EVIDENCE_SOURCES = new Set([
  'reader_observation',
  'story',
  'writer_packet',
  'cut',
  'trajectory',
  'model',
  'test_result',
]);
const SHA256 = /^[0-9a-f]{64}$/u;

const REVISION_GUIDANCE = Object.freeze({
  model: Object.freeze({
    action: 'revise-model-then-rerun-from-bound-parent',
    invalidates: Object.freeze([
      'model',
      'cut-or-projection',
      'trajectory',
      'writer-packet',
      'rendering',
    ]),
    verification: Object.freeze([
      'validate the successor model and its provenance',
      'show the missing mechanism through an explicit causal path',
      'run a matched intervention or ablation from the bound parent',
      're-audit every downstream projection and rendering',
    ]),
  }),
  cut: Object.freeze({
    action: 'revise-cut-then-recompute-or-repacket',
    invalidates: Object.freeze([
      'cut-or-projection',
      'affected-trajectory-if-executable',
      'writer-packet',
      'rendering',
    ]),
    verification: Object.freeze([
      'preserve identity, accepted history, authority, and viewpoint',
      'check parent-child recomposition and record any residual',
      'show that the new resolution changes the declared query',
      'rerun affected dynamics, or only repacket when the change is projection-only',
    ]),
  }),
  trajectory: Object.freeze({
    action: 'revise-dynamics-or-reroll-from-same-frozen-parent',
    invalidates: Object.freeze(['trajectory', 'writer-packet', 'rendering']),
    verification: Object.freeze([
      'compare matched candidates from the same frozen parent',
      'check chronology, declared jumps, lags, and conserved quantities',
      'show the intended downstream change under a relevant intervention',
      'show stability under an irrelevant control',
    ]),
  }),
  rendering: Object.freeze({
    action: 'rerender-same-canon',
    invalidates: Object.freeze(['rendering']),
    verification: Object.freeze([
      'keep model, cut, trajectory, and writer-packet hashes unchanged',
      'recheck plot-critical grounding, chronology, and viewpoint boundaries',
      'ask readers whether the cited weakness remains without treating their answer as objective truth',
    ]),
  }),
  undetermined: Object.freeze({
    action: 'collect-discriminating-evidence-before-revision',
    invalidates: Object.freeze([]),
    verification: Object.freeze([
      'test unresolved foundational layers before changing canon',
      'retain the reader observation as a hypothesis rather than a verdict',
    ]),
  }),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ensureRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
}

function ensureOnlyKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}.`);
}

function ensureString(value, label, maximum = 2_000) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    throw new Error(`${label} must be a nonempty string of at most ${maximum} characters.`);
  }
}

function ensureHash(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeAuthority(authority) {
  ensureRecord(authority, 'authority');
  ensureOnlyKeys(
    authority,
    ['modelHash', 'cutHash', 'trajectoryHash', 'writerPacketHash', 'storyHash'],
    'authority',
  );
  for (const key of [
    'modelHash',
    'cutHash',
    'trajectoryHash',
    'writerPacketHash',
    'storyHash',
  ]) {
    ensureHash(authority[key], `authority.${key}`);
  }
  return structuredClone(authority);
}

function normalizeObservations(observations) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 100) {
    throw new Error('readerObservations must contain between 1 and 100 cited observations.');
  }
  const seen = new Set();
  return observations.map((observation, index) => {
    const label = `readerObservations[${index}]`;
    ensureRecord(observation, label);
    ensureOnlyKeys(
      observation,
      ['observationId', 'statement', 'epistemicStatus', 'citation'],
      label,
    );
    ensureString(observation.observationId, `${label}.observationId`, 200);
    if (seen.has(observation.observationId)) {
      throw new Error(`readerObservations repeats ${observation.observationId}.`);
    }
    seen.add(observation.observationId);
    ensureString(observation.statement, `${label}.statement`, 4_000);
    if (!STORY_OBSERVATION_STATUSES.includes(observation.epistemicStatus)) {
      throw new Error(`${label}.epistemicStatus is unsupported.`);
    }
    ensureRecord(observation.citation, `${label}.citation`);
    ensureOnlyKeys(observation.citation, ['sceneId', 'excerpt'], `${label}.citation`);
    ensureString(observation.citation.sceneId, `${label}.citation.sceneId`, 500);
    ensureString(observation.citation.excerpt, `${label}.citation.excerpt`, 4_000);
    return structuredClone(observation);
  });
}

function normalizeCitation(citation, label) {
  ensureRecord(citation, label);
  ensureOnlyKeys(citation, ['source', 'reference', 'note'], label);
  if (!EVIDENCE_SOURCES.has(citation.source)) {
    throw new Error(`${label}.source is unsupported.`);
  }
  ensureString(citation.reference, `${label}.reference`, 1_000);
  ensureString(citation.note, `${label}.note`, 4_000);
  return structuredClone(citation);
}

function normalizeLayerEvidence(layerEvidence) {
  ensureRecord(layerEvidence, 'layerEvidence');
  ensureOnlyKeys(layerEvidence, DIAGNOSABLE_LAYERS, 'layerEvidence');
  return Object.fromEntries(
    DIAGNOSABLE_LAYERS.map((layer) => {
      const evidence = layerEvidence[layer];
      const label = `layerEvidence.${layer}`;
      ensureRecord(evidence, label);
      ensureOnlyKeys(evidence, ['status', 'finding', 'citations'], label);
      if (!STORY_REVISION_EVIDENCE_STATUSES.includes(evidence.status)) {
        throw new Error(`${label}.status is unsupported.`);
      }
      ensureString(evidence.finding, `${label}.finding`, 4_000);
      if (!Array.isArray(evidence.citations) || evidence.citations.length > 50) {
        throw new Error(`${label}.citations must contain at most 50 entries.`);
      }
      if (evidence.status !== 'unknown' && evidence.citations.length === 0) {
        throw new Error(`${label} needs cited evidence for a ${evidence.status} finding.`);
      }
      return [
        layer,
        {
          status: evidence.status,
          finding: evidence.finding,
          citations: evidence.citations.map((citation, index) =>
            normalizeCitation(citation, `${label}.citations[${index}]`)),
        },
      ];
    }),
  );
}

function classify(layerEvidence) {
  for (const layer of DIAGNOSABLE_LAYERS) {
    const { status } = layerEvidence[layer];
    if (status === 'unknown') {
      return {
        primaryLayer: 'undetermined',
        rationale:
          `${layer} adequacy is unresolved, so a less foundational revision cannot yet be justified.`,
      };
    }
    if (status === 'insufficient') {
      return {
        primaryLayer: layer,
        rationale:
          `${layer} is the earliest insufficient layer after all more foundational layers were found sufficient.`,
      };
    }
  }
  return {
    primaryLayer: 'undetermined',
    rationale:
      'All supplied layers were found sufficient; the cited response may be a reader preference or may require evidence outside this diagnostic.',
  };
}

/**
 * Produces a read-only, evidence-bound revision diagnosis. The function does
 * not inspect or mutate canonical state, rewrite prose, or judge literary
 * quality. Supplied adequacy findings remain caller assertions with citations.
 */
export function diagnoseStoryRevision({
  diagnosisId,
  authority,
  readerObservations,
  layerEvidence,
} = {}) {
  ensureString(diagnosisId, 'diagnosisId', 200);
  const normalizedAuthority = normalizeAuthority(authority);
  const normalizedObservations = normalizeObservations(readerObservations);
  const normalizedEvidence = normalizeLayerEvidence(layerEvidence);
  const classified = classify(normalizedEvidence);
  const guidance = REVISION_GUIDANCE[classified.primaryLayer];

  const diagnosis = {
    schema: 'life-sim-story-revision-diagnosis/v1',
    diagnosisId,
    authority: normalizedAuthority,
    readerObservations: normalizedObservations,
    layerEvidence: normalizedEvidence,
    classification: {
      primaryLayer: classified.primaryLayer,
      status:
        classified.primaryLayer === 'undetermined'
          ? 'insufficient-to-classify'
          : 'provisional-from-supplied-evidence',
      rationale: classified.rationale,
      smallestValidRevision: guidance.action,
      invalidatedArtifacts: [...guidance.invalidates],
      verification: [...guidance.verification],
    },
    boundary: {
      readOnly: true,
      canonicalWorldMutation: false,
      automaticRewrite: false,
      literaryQualityAssessment: 'not-performed',
      readerObservationsAreObjectiveVerdicts: false,
      note:
        'The diagnosis localizes a revision hypothesis. It does not establish that a story is good, bad, realistic, beautiful, or preferred by readers generally.',
    },
  };
  diagnosis.diagnosisHash = hash(diagnosis);
  return deepFreeze(diagnosis);
}

