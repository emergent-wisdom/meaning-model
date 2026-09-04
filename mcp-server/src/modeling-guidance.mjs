import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const modelingPurposes = Object.freeze([
  'creative_story',
  'source_reconstruction',
  'person_reflection',
  'observation',
  'forecasting',
  'counterfactual',
]);

export const modelingSessionModes = Object.freeze([
  'first_use',
  'repeat_same_domain',
  'new_domain',
  'consequential',
]);

export const modelingTheoryUris = Object.freeze([
  'life-sim://theory/meaning-model',
  'life-sim://theory/life-simulation',
]);

const resourceDefinitions = Object.freeze([
  {
    id: 'meaning-model-paper',
    uri: 'life-sim://theory/meaning-model',
    title: 'The Meaning Model: Constructing Worlds and Stories at Progressive Resolution',
    description:
      'Canonical theory and construction manuscript for progressively resolved worlds, concepts, perspective-separated understanding, and stories.',
    mimeType: 'text/x-tex',
    file: new URL('../../paper/meaning-model.tex', import.meta.url),
    category: 'theory',
  },
  {
    id: 'life-simulation-paper',
    uri: 'life-sim://theory/life-simulation',
    title: 'Life Simulation - frozen companion paper source',
    description:
      'Frozen companion theory of temporal trajectories, candidate worlds, learning, accepted chronology, and projections; source file digests are recorded in docs/companions/life-simulation/SOURCE.json.',
    mimeType: 'text/x-tex',
    file: new URL('../../docs/companions/life-simulation/life-simulation.tex', import.meta.url),
    category: 'theory',
  },
  {
    id: 'modeling-protocol',
    uri: 'life-sim://protocol/modeling',
    title: 'Meaning Model Modeling Protocol',
    description:
      'Operational checklist used after the complete papers have been understood.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/MODELING_PROTOCOL.md', import.meta.url),
    category: 'protocol',
  },
  {
    id: 'narrative-understanding-graph-protocol',
    uri: 'life-sim://protocol/narrative-understanding-graph',
    title: 'Narrative Understanding Graph Protocol',
    description:
      'Exact optional Rust graph schema, atomic batch workflow, projections, anchors, and limitations.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/NARRATIVE_UNDERSTANDING_GRAPH.md', import.meta.url),
    category: 'protocol',
  },
  {
    id: 'story-profile',
    uri: 'life-sim://profile/story',
    title: 'Story Modeling Profile',
    description: 'Purpose-specific instructions and output contract for fiction and source reconstruction.',
    mimeType: 'text/markdown',
    file: new URL('../../profiles/STORY_MODELING.md', import.meta.url),
    category: 'profile',
  },
  {
    id: 'person-profile',
    uri: 'life-sim://profile/person',
    title: 'Person Modeling Profile',
    description: 'Consent-bounded three-view instructions for reflective modeling of a life interval.',
    mimeType: 'text/markdown',
    file: new URL('../../profiles/PERSON_MODELING.md', import.meta.url),
    category: 'profile',
  },
  {
    id: 'everest-meaning-example',
    uri: 'life-sim://example/everest-meaning-model',
    title: 'Everest Meaning Model Example',
    description: 'Checked authored example connecting semantic records to an executed Everest world.',
    mimeType: 'text/markdown',
    file: new URL(
      '../../docs/examples/EVEREST-MEANING-MODEL.md',
      import.meta.url,
    ),
    category: 'example',
  },
  {
    id: 'fearless-care-example',
    uri: 'life-sim://example/fearless-care',
    title: 'Fearless Care Matched Experiment',
    description:
      'Rust-backed fictional comparison separating threat knowledge, fear, concern, attachment, and action consequences.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/examples/FEARLESS-CARE.md', import.meta.url),
    category: 'example',
  },
]);

const byUri = new Map(resourceDefinitions.map((definition) => [definition.uri, definition]));

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function loadDefinition(definition) {
  const text = await readFile(definition.file, 'utf8');
  return {
    id: definition.id,
    uri: definition.uri,
    title: definition.title,
    description: definition.description,
    mimeType: definition.mimeType,
    category: definition.category,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text),
    text,
  };
}

export function listModelingResources() {
  return resourceDefinitions.map(({ file: _file, ...definition }) => ({ ...definition }));
}

export async function readModelingResource(uri) {
  const definition = byUri.get(uri);
  if (!definition) throw new Error(`Unknown modeling resource ${uri}.`);
  return loadDefinition(definition);
}

function profileUri(purpose) {
  if (purpose === 'creative_story' || purpose === 'source_reconstruction') {
    return 'life-sim://profile/story';
  }
  if (purpose === 'person_reflection') return 'life-sim://profile/person';
  return null;
}

function exampleUri(purpose) {
  if (purpose === 'person_reflection') return 'life-sim://example/fearless-care';
  if (purpose === 'creative_story' || purpose === 'source_reconstruction') {
    return 'life-sim://example/everest-meaning-model';
  }
  return 'life-sim://example/everest-meaning-model';
}

function ensurePurpose(purpose) {
  if (!modelingPurposes.includes(purpose)) {
    throw new Error(`Unsupported modeling purpose ${purpose}.`);
  }
}

function ensureMode(sessionMode) {
  if (!modelingSessionModes.includes(sessionMode)) {
    throw new Error(`Unsupported modeling session mode ${sessionMode}.`);
  }
}

export async function buildModelingContext({
  purpose,
  sessionMode,
  readTheoryUris = [],
}) {
  ensurePurpose(purpose);
  ensureMode(sessionMode);
  const [meaning, life, protocol] = await Promise.all([
    readModelingResource('life-sim://theory/meaning-model'),
    readModelingResource('life-sim://theory/life-simulation'),
    readModelingResource('life-sim://protocol/modeling'),
  ]);
  const theoryDigests = {
    meaningModel: meaning.sha256,
    lifeSimulation: life.sha256,
  };
  const readTheorySet = new Set(readTheoryUris);
  const accessedCurrentTheory = modelingTheoryUris.every((uri) => readTheorySet.has(uri));
  const requiresFullTheoryRead = sessionMode !== 'repeat_same_domain' || !accessedCurrentTheory;
  const selectedProfile = profileUri(purpose);
  const selectedExample = exampleUri(purpose);
  const orderedResources = [
    {
      uri: meaning.uri,
      sha256: meaning.sha256,
      required: requiresFullTheoryRead,
      reason: requiresFullTheoryRead
        ? 'Required before substantive first-use, changed-theory, new-domain, or consequential modeling.'
        : 'Already accessed in this live MCP process for repeat work in the same domain; reread whenever interpretation is uncertain.',
    },
    {
      uri: life.uri,
      sha256: life.sha256,
      required: requiresFullTheoryRead,
      reason: requiresFullTheoryRead
        ? 'Required to understand temporal state, inference, candidate authority, and accepted chronology.'
        : 'Already accessed in this live MCP process for repeat work in the same domain; reread whenever interpretation is uncertain.',
    },
    {
      uri: protocol.uri,
      sha256: protocol.sha256,
      required: true,
      reason: 'Use as the execution checklist after theory comprehension.',
    },
    {
      uri: 'life-sim://protocol/narrative-understanding-graph',
      required: false,
      reason: 'Read before first use of the optional graph-native story, testimony, rendering, or training-export tools.',
    },
    ...(selectedProfile
      ? [{ uri: selectedProfile, required: true, reason: 'Purpose-specific modeling and output contract.' }]
      : []),
    { uri: selectedExample, required: true, reason: 'Inspect one worked representation before expanding the model.' },
  ];
  return {
    schema: 'life-sim-modeling-context/v2',
    purpose,
    sessionMode,
    paperFirst: true,
    requiresFullTheoryRead,
    theoryDigests,
    theoryAccessGate: {
      requiredUris: modelingTheoryUris,
      readUris: modelingTheoryUris.filter((uri) => readTheorySet.has(uri)),
      satisfied: accessedCurrentTheory,
      durableAcrossServerRestart: false,
    },
    comprehensionBoundary:
      'The live server can verify that both complete resources were accessed, not that an agent understood them. Digests prove byte identity only and never satisfy the access gate.',
    orderedResources,
    minimumChecklist: [
      'declare purpose, interval, scope, resolution, and authority',
      'identify continuing referents and accepted event history',
      'separate observations, reports, estimates, completions, forecasts, and creative premises',
      'represent sampled trajectories before inventing transition laws',
      'preserve competing interpretations, uncertainty, provenance, viewpoint, and residuals',
      'test causal use, irrelevant-input stability, and coarse-fine conservation',
      'revise explicitly and project only the requested view',
    ],
    valueAndFunctionSupport: {
      sampledValues:
        'Submit time-stamped provisional claims; an observed forward value can be materialized only through a separate candidate roll and atomic acceptance.',
      functions:
        'Propose a complete successor ModelDefinition with declared semantic changes and laws, review it, then register the immutable revision separately.',
      rule: 'A value series does not require an invented generating function.',
    },
    personalModelViews:
      purpose === 'person_reflection'
        ? [
            'external event history',
            'alternative AI-inferred actor-local models',
            'the person\'s reported self-model',
          ]
        : [],
    safetyBoundary:
      purpose === 'person_reflection'
        ? 'Revisable, consent-bounded, non-diagnostic hypothesis; never privileged mind reading.'
        : 'Preserve the declared reality, source-reconstruction, counterfactual, or creative authority boundary.',
  };
}

export async function buildModelingPrompt({ purpose, sessionMode }) {
  const context = await buildModelingContext({
    purpose,
    sessionMode,
    readTheoryUris: [],
  });
  const ordered = context.orderedResources
    .map((resource, index) => `${index + 1}. ${resource.uri}${resource.required ? ' (required)' : ''}`)
    .join('\n');
  return [
    `Begin a ${purpose} Meaning Model modeling session in ${sessionMode} mode.`,
    '',
    'Do not treat the short protocol as a substitute for the theory. Call life_modeling_context, then read the complete current papers and its other required resources in order:',
    ordered,
    '',
    'Only after that reading, declare purpose, interval, scope, resolution, authority, and evidence classes. Preserve alternative interpretations and use sampled trajectories before proposing unsupported functions.',
  ].join('\n');
}
