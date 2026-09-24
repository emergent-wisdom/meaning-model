import { thinkInTheModelInstructions } from './model-questions.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { constructionRecordInstructions } from './construction-principles.mjs';

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
  'continuation',
]);

// Continuing someone's recorded work: read the record before changing it, then keep recording.
export const continuationSteps = Object.freeze([
  'Read life_construction_replay on the graph you were given, from the start at outline level: every model and graph revision with the first line of each note.',
  'Read life_model_outline on the same graph: the current Events, Cuts, concepts and the notes attached to them.',
  'Open reasoning or full detail, life_narrative_query or life_model_inspect only where you need it, before your first change.',
  'Record your reading and your plan as notes under your own holder before changing anything; link notes that build on, answer or replace earlier ones with refines, answers or supersedes.',
]);

// How much theory an agent reads before modeling. "papers" (the default) asks for both complete
// papers before the first substantive run. "guides" makes the guides and protocol the entry and
// the papers a reference opened where a rule needs its reason. It exists to test whether the
// tool's own guidance is enough; the served protocol and storytelling guide change with it.
export function readingMode(env = process.env) {
  return env.MEANING_MODEL_READING === 'guides' ? 'guides' : 'papers';
}

const guidesEntry = `## Entry

The guides and this protocol carry the procedure; the papers carry the reasons. Before a first
substantive model, read this protocol, the guide or profile for your purpose, and one worked
example. *The Meaning Model* and *Life Simulation* are the theory behind every rule here. You
need not read them first: open one, or the section a guide names, when a rule or a distinction
needs its reason, when the work enters a new domain, or when a result surprises you. The server
does not record what you read.

`;

// The served text of a resource under the guides reading mode; unchanged under papers.
export function servedText(uri, text, reading = readingMode()) {
  if (reading !== 'guides') return text;
  const replaceOnce = (source, pattern, replacement) => {
    if (!pattern.test(source)) throw new Error(`Reading mode guides cannot adapt ${uri}: its entry text changed.`);
    return source.replace(pattern, replacement);
  };
  if (uri === 'life-sim://protocol/modeling') {
    let adapted = replaceOnce(text, /## Paper-first entry contract\n[\s\S]*?(?=## Common procedure)/u, guidesEntry);
    adapted = replaceOnce(adapted, /The required paper-grounded flow is:/u, 'The flow is:');
    adapted = replaceOnce(adapted, /2\. Read both complete theory resources, then the protocol, profile, and example\.\n[\s\S]*?check `theoryAccessGate` after reading\.\n/u,
      '2. Read the protocol, the guide or profile, and the example; open a paper where one of them\n   points for the reason behind a rule.\n');
    return adapted;
  }
  if (uri === 'life-sim://addon/storytelling') {
    return replaceOnce(text, /Read the required Meaning Model and Life Simulation paper resources and common\nmodeling protocol before authoring a model\./u,
      'Read the common modeling protocol before authoring a model, and open the Meaning Model\nand Life Simulation papers where it points for the reasons behind a rule.');
  }
  return text;
}

export const modelingTheoryUris = Object.freeze([
  'life-sim://theory/meaning-model',
  'life-sim://theory/life-simulation',
]);

export const modelingFreedom =
  `The modeler chooses the form: processes, categories, relationships and vocabulary fitted to the application, whether adapted from a template or authored directly. The freedom is over form, not over depth. ${thinkInTheModelInstructions} Use the account to compare explanations, explore developments and guide inquiry; develop and revise its categories as part of that work, preserving earlier versions and the applicable validation and authority rules.`;

export const starterSelection =
  'Give every person who matters to the work a whole life: a lifecycle Event over their full interval holding the processes their life runs through, opened with periods with intervals, shocks as change arcs (change_arc_scaffold) with their adaptations, and Cuts for what they want, expect and feel at the moments that matter. Templates are suggestions. Look at person_scaffold (the Book\'s nine slow processes: body, kin, partnership, work, place, means, knowledge, standing, meaning) and ask: would this person be understood better through it, through processes invented for them, or through subcategories of either? Choose what explains them most deeply, and ask again as the life deepens. A market, an institution or a technology is modeled the same way, as processes over their own long time. Structural starters load identities and Events without default semantic scores, so the numbers are yours to estimate. Story and Decision compilers add particular authored numerical meanings and behavioural laws; inspect and choose those assumptions explicitly.';

export const scaleReview =
  'Start macro to micro: assess the enclosing system and its longer-term developments before selecting local detail. State the focal interval and a useful broader horizon; connect large-scale processes and enduring events to the focal processes through evidenced relationships or explicit hypotheses. Record the assessment in Understanding Nodes, with missing evidence and deliberate scope exclusions. Choose depth and timescales for the question, without a fixed ontology or horizon. A long event alone is not a numerical trend: retain dated process values, their evidence cutoffs and uncertainty. Revisit the broader account when local findings change it.';

export const conceptualReview =
  'Within the agreed delegation, review numerical meaning and conceptual depth without waiting for the user to suggest them. Consider authored judgment scales for relevant meanings, motives, capacities or process changes that are not directly measured; define their comparison, units, anchors and uncertainty, and preserve source measurements separately. Open important concepts into useful parts or alternative lenses using native concepts and abstract cuts, then deepen a child when its label does not explain the relevant behavior or distinction. Assess how meanings differ across dates, actors or contexts; distinguish a changing world from a changed estimate, viewpoint or rubric. Store these assessments as Understanding Nodes linked to the actual definitions and evidence. Revisit them after consequential findings or revisions. Explain adequate boundaries, missing evidence or deliberate exclusions; do not invent scores, change or detail just to fill a checklist.';

const resourceDefinitions = Object.freeze([
  {
    id: 'meaning-model-paper',
    uri: 'life-sim://theory/meaning-model',
    title: 'The Meaning Model: Constructing Worlds and Stories at Progressive Resolution',
    description:
      'Canonical theory and construction manuscript for progressively resolved worlds, concepts, perspective-separated understanding, and stories. Its included files are expanded inline.',
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
    id: 'general-modeling-guide',
    uri: 'life-sim://guide/general-modeling',
    title: 'General-purpose World Modeling with Jev',
    description: 'Macro-to-micro modeling, long-term context, domain-defined processes, compact world construction, optional Jev estimation and graph-backed review without storytelling requirements.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/GENERAL_MODELING.md', import.meta.url),
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
  {
    id: 'minimal-model-and-graph-example',
    uri: 'life-sim://example/minimal-model-and-graph',
    title: 'Minimal Model and Graph: complete valid payloads',
    description: 'Copyable, test-verified payloads for life_profile_compile, life_model_register (one referent, events, a scalar process and a normalized Cut) and life_narrative_register (one document root and one dated canon record with anchors).',
    mimeType: 'text/markdown',
    file: new URL('../../docs/examples/MINIMAL-MODEL-AND-GRAPH.md', import.meta.url),
    category: 'example',
  },
  {
    id: 'application-categories-example',
    uri: 'life-sim://example/application-categories',
    title: 'Application-Specific Categories and Revision',
    description: 'Choose optional starters, use a model for inquiry, and revise application categories with an executable Rust example.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/examples/APPLICATION-CATEGORIES.md', import.meta.url),
    category: 'example',
  },
]);

const byUri = new Map(resourceDefinitions.map((definition) => [definition.uri, definition]));

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// A served LaTeX paper includes its \input files inline, so a reader of the resource sees the
// definitions, boxes and figures the text relies on. Only plain relative names are expanded.
export async function expandTexInputs(text, file) {
  const pattern = /^[ \t]*\\input\{([A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-]+)*)(\.tex)?\}[ \t]*$/gm;
  const names = [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
  const included = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(`${name}.tex`, file), 'utf8')])));
  return text.replace(pattern, (_line, name) => `% ---- Begin included file ${name}.tex, expanded inline for this resource ----\n${included.get(name).replace(/\n$/, '')}\n% ---- End included file ${name}.tex ----`);
}

async function loadDefinition(definition, reading = readingMode()) {
  const raw = await readFile(definition.file, 'utf8');
  const text = servedText(definition.uri, definition.mimeType === 'text/x-tex' ? await expandTexInputs(raw, definition.file) : raw, reading);
  return {
    id: definition.id,
    uri: definition.uri,
    title: definition.title,
    description: describedFor(definition, reading),
    mimeType: definition.mimeType,
    category: definition.category,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text),
    text,
  };
}

function describedFor(definition, reading) {
  return reading === 'guides' && definition.id === 'modeling-protocol'
    ? 'Operational checklist for modeling; the papers carry the reasons behind it.'
    : definition.description;
}

export function listModelingResources(reading = readingMode()) {
  return resourceDefinitions.map(({ file: _file, ...definition }) => ({ ...definition, description: describedFor(definition, reading) }));
}

export async function readModelingResource(uri, reading = readingMode()) {
  const definition = byUri.get(uri);
  if (!definition) throw new Error(`Unknown modeling resource ${uri}.`);
  return loadDefinition(definition, reading);
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
  return 'life-sim://example/minimal-model-and-graph';
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
  reading = readingMode(),
}) {
  ensurePurpose(purpose);
  ensureMode(sessionMode);
  const [meaning, life, protocol] = await Promise.all([
    readModelingResource('life-sim://theory/meaning-model', reading),
    readModelingResource('life-sim://theory/life-simulation', reading),
    readModelingResource('life-sim://protocol/modeling', reading),
  ]);
  const theoryDigests = {
    meaningModel: meaning.sha256,
    lifeSimulation: life.sha256,
  };
  const readTheorySet = new Set(readTheoryUris);
  const accessedCurrentTheory = modelingTheoryUris.every((uri) => readTheorySet.has(uri));
  const guides = reading === 'guides';
  const requiresFullTheoryRead = !guides && (sessionMode !== 'repeat_same_domain' || !accessedCurrentTheory);
  const theoryReference = 'The theory behind the guides. You need not read it first: open it, or the section a guide names, when a rule or a distinction needs its reason.';
  const selectedProfile = profileUri(purpose);
  const selectedExample = exampleUri(purpose);
  const orderedResources = [
    {
      uri: meaning.uri,
      sha256: meaning.sha256,
      required: requiresFullTheoryRead,
      reason: guides ? theoryReference : requiresFullTheoryRead
        ? 'Required before substantive first-use, changed-theory, new-domain, or consequential modeling.'
        : 'Already accessed in this live MCP process for repeat work in the same domain; reread whenever interpretation is uncertain.',
    },
    {
      uri: life.uri,
      sha256: life.sha256,
      required: requiresFullTheoryRead,
      reason: guides ? theoryReference : requiresFullTheoryRead
        ? 'Required to understand temporal state, inference, candidate authority, and accepted chronology.'
        : 'Already accessed in this live MCP process for repeat work in the same domain; reread whenever interpretation is uncertain.',
    },
    {
      uri: protocol.uri,
      sha256: protocol.sha256,
      required: true,
      reason: guides ? 'The execution checklist.' : 'Use as the execution checklist after theory comprehension.',
    },
    {
      uri: 'life-sim://protocol/narrative-understanding-graph',
      required: false,
      reason: 'Read before first use of the optional graph-native story, testimony, rendering, or training-export tools.',
    },
    ...(!selectedProfile ? [{ uri: 'life-sim://guide/general-modeling', required: true, reason: 'General modeling workflow, compact construction, optional Jev estimation and exact review/record boundaries.' }] : []),
    ...(selectedProfile
      ? [{ uri: selectedProfile, required: true, reason: 'Purpose-specific modeling and output contract.' }]
      : []),
    { uri: selectedExample, required: true, reason: 'Inspect one worked representation before expanding the model.' },
    { uri: 'life-sim://example/application-categories', required: false, reason: 'Use when choosing a starter or developing and revising application-specific categories.' },
  ];
  return {
    schema: 'life-sim-modeling-context/v2',
    purpose,
    workflow: purpose === 'creative_story' || purpose === 'source_reconstruction' ? 'storytelling' : 'general_modeling',
    sessionMode,
    modelingFreedom,
    starterSelection,
    scaleReview,
    conceptualReview,
    constructionRecord: constructionRecordInstructions,
    ...(sessionMode === 'continuation' ? { continuation: { steps: continuationSteps, note: 'The record is the earlier agent\'s understanding. Build on it; where you disagree, record why and link it with contradicts or supersedes rather than silently replacing it.' } } : {}),
    paperFirst: !guides,
    readingMode: reading,
    requiresFullTheoryRead,
    theoryDigests,
    theoryAccessGate: {
      requiredUris: guides ? [] : modelingTheoryUris,
      readUris: modelingTheoryUris.filter((uri) => readTheorySet.has(uri)),
      satisfied: guides || accessedCurrentTheory,
      durableAcrossServerRestart: false,
    },
    comprehensionBoundary: guides
      ? 'The guides carry the procedure and the papers the reasons. The server does not check what was read or understood.'
      : 'The live server can verify that both complete resources were accessed, not that an agent understood them. Digests prove byte identity only and never satisfy the access gate.',
    orderedResources,
    minimumChecklist: [
      'declare purpose, interval, scope, resolution, and authority',
      'assess the enclosing system and longer-term trends before local detail; link supporting processes/events or record unknowns and justified exclusions in Understanding Nodes',
      'choose application-specific processes and categories; inspect any starter assumptions and omit unnecessary layers',
      'consider authored numerical judgment scales as well as measured values, with explicit meanings and comparison anchors',
      'open important concepts into native concepts and abstract cuts when useful; explain a sufficient boundary or missing evidence instead of adding arbitrary depth',
      'compare dated or perspective-specific meanings and preserve the difference between conceptual change, revised estimates and changed rubrics',
      'identify continuing referents and accepted event history',
      'separate observations, reports, estimates, completions, forecasts, and creative premises',
      'connect earlier and later states through supporting events, reports, or declared laws; distinguish world changes from revised estimates and leave unexplained transitions open',
      'represent sampled trajectories before inventing transition laws',
      'preserve competing interpretations, uncertainty, provenance, viewpoint, and residuals',
      'test causal use, irrelevant-input stability, and coarse-fine conservation',
      'compare alternative decompositions and revise categories when a different account better serves the task',
      'revise explicitly and project only the requested view',
      'describe every Event that carries a Cut, and most other Events, so their numbers mean something',
      'record choices, ideas, predictions and reasons as Understanding Nodes linked to what they concern, and outside reviews under their actual reviewers; replay the construction before continuing existing work',
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

export async function buildModelingPrompt({ purpose, sessionMode, reading = readingMode() }) {
  const context = await buildModelingContext({
    purpose,
    sessionMode,
    readTheoryUris: [],
    reading,
  });
  const ordered = context.orderedResources
    .map((resource, index) => `${index + 1}. ${resource.uri}${resource.required ? ' (required)' : ''}`)
    .join('\n');
  return [
    `Begin a Meaning Model modeling session. Purpose: ${purpose}. Session mode: ${sessionMode}.`,
    '',
    ...(context.continuation ? ['You are continuing recorded work. Before any change:', ...context.continuation.steps.map((step, index) => `${index + 1}. ${step}`), context.continuation.note, ''] : []),
    context.modelingFreedom,
    '',
    context.starterSelection,
    '',
    context.scaleReview,
    '',
    context.conceptualReview,
    '',
    context.readingMode === 'guides'
      ? 'Call life_modeling_context, then read its required resources in order. The papers are the theory behind the guides: open one, or the section a guide names, when a rule or a distinction needs its reason.'
      : 'Do not treat the short protocol as a substitute for the theory. Call life_modeling_context, then read the complete current papers and its other required resources in order:',
    ordered,
    '',
    `${context.readingMode === 'guides' ? 'After that reading' : 'Only after that reading'}, declare purpose, interval, scope, resolution, authority, and evidence classes. Preserve alternative interpretations and use sampled trajectories before proposing unsupported functions.`,
    '',
    constructionRecordInstructions,
  ].join('\n');
}
