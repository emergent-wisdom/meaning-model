import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseStoryRevision } from '../src/story-revision-diagnostic.mjs';

const hashes = Object.freeze({
  modelHash: '1'.repeat(64),
  cutHash: '2'.repeat(64),
  trajectoryHash: '3'.repeat(64),
  writerPacketHash: '4'.repeat(64),
  storyHash: '5'.repeat(64),
});

function citation(source, reference) {
  return {
    source,
    reference,
    note: `Evidence recorded at ${reference}.`,
  };
}

function baseInput() {
  return {
    diagnosisId: 'diagnosis_1',
    authority: { ...hashes },
    readerObservations: [
      {
        observationId: 'under-earned-turn',
        statement: 'The character change feels under-earned to this reader.',
        epistemicStatus: 'reader_report',
        citation: {
          sceneId: 'scene-12',
          excerpt: 'She accepted the offer before the bell stopped ringing.',
        },
      },
    ],
    layerEvidence: {
      model: {
        status: 'sufficient',
        finding: 'The model contains motive, relationship, and option processes.',
        citations: [citation('model', 'processes:41-49')],
      },
      cut: {
        status: 'sufficient',
        finding: 'The focal cut exposes the relevant interaction and viewpoint.',
        citations: [citation('cut', 'cut:scene-12')],
      },
      trajectory: {
        status: 'sufficient',
        finding: 'The accepted path contains pressure, deliberation, and commitment.',
        citations: [citation('trajectory', 'candidate:scene-12')],
      },
      rendering: {
        status: 'insufficient',
        finding: 'The prose omits the accepted intervening actions.',
        citations: [citation('story', 'scene-12:paragraphs-4-7')],
      },
    },
  };
}

test('classifies a supported surface failure as a same-canon rendering revision', () => {
  const diagnosis = diagnoseStoryRevision(baseInput());

  assert.equal(diagnosis.classification.primaryLayer, 'rendering');
  assert.equal(diagnosis.classification.smallestValidRevision, 'rerender-same-canon');
  assert.deepEqual(diagnosis.classification.invalidatedArtifacts, ['rendering']);
  assert.equal(diagnosis.boundary.canonicalWorldMutation, false);
  assert.equal(diagnosis.boundary.literaryQualityAssessment, 'not-performed');
  assert.match(diagnosis.diagnosisHash, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(diagnosis), true);
  assert.equal(Object.isFrozen(diagnosis.classification.verification), true);
});

test('selects the earliest insufficient foundational layer', () => {
  const cases = [
    ['model', 'revise-model-then-rerun-from-bound-parent'],
    ['cut', 'revise-cut-then-recompute-or-repacket'],
    ['trajectory', 'revise-dynamics-or-reroll-from-same-frozen-parent'],
  ];

  for (const [layer, action] of cases) {
    const input = baseInput();
    input.diagnosisId = `diagnosis_${layer}`;
    for (const candidate of ['model', 'cut', 'trajectory', 'rendering']) {
      input.layerEvidence[candidate].status =
        candidate === layer ? 'insufficient' : 'sufficient';
    }
    const diagnosis = diagnoseStoryRevision(input);
    assert.equal(diagnosis.classification.primaryLayer, layer);
    assert.equal(diagnosis.classification.smallestValidRevision, action);
  }
});

test('returns undetermined when a more foundational layer is unknown', () => {
  const input = baseInput();
  input.layerEvidence.cut = {
    status: 'unknown',
    finding: 'No resolution comparison has been run.',
    citations: [],
  };

  const diagnosis = diagnoseStoryRevision(input);
  assert.equal(diagnosis.classification.primaryLayer, 'undetermined');
  assert.equal(
    diagnosis.classification.smallestValidRevision,
    'collect-discriminating-evidence-before-revision',
  );
  assert.deepEqual(diagnosis.classification.invalidatedArtifacts, []);
  assert.match(diagnosis.classification.rationale, /cut adequacy is unresolved/);
});

test('all-sufficient evidence does not become an objective literary verdict', () => {
  const input = baseInput();
  input.layerEvidence.rendering = {
    status: 'sufficient',
    finding: 'No trace or rendering defect was established.',
    citations: [citation('test_result', 'grounding-audit:pass')],
  };

  const diagnosis = diagnoseStoryRevision(input);
  assert.equal(diagnosis.classification.primaryLayer, 'undetermined');
  assert.equal(diagnosis.classification.status, 'insufficient-to-classify');
  assert.equal(diagnosis.boundary.readerObservationsAreObjectiveVerdicts, false);
  assert.match(diagnosis.boundary.note, /does not establish that a story is good, bad/);
});

test('validation requires bound hashes, cited observations, and cited non-unknown findings', () => {
  const invalidHash = baseInput();
  invalidHash.authority.storyHash = 'not-a-hash';
  assert.throws(
    () => diagnoseStoryRevision(invalidHash),
    /authority.storyHash must be a lowercase SHA-256 digest/,
  );

  const uncitedObservation = baseInput();
  uncitedObservation.readerObservations[0].citation.excerpt = '';
  assert.throws(
    () => diagnoseStoryRevision(uncitedObservation),
    /citation.excerpt must be a nonempty string/,
  );

  const uncitedFinding = baseInput();
  uncitedFinding.layerEvidence.model.citations = [];
  assert.throws(
    () => diagnoseStoryRevision(uncitedFinding),
    /needs cited evidence for a sufficient finding/,
  );
});

test('diagnosis is deterministic and does not mutate caller input', () => {
  const input = baseInput();
  const before = structuredClone(input);
  const first = diagnoseStoryRevision(input);
  const second = diagnoseStoryRevision(structuredClone(input));

  assert.deepEqual(input, before);
  assert.equal(first.diagnosisHash, second.diagnosisHash);
  assert.deepEqual(first, second);
});
