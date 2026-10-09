import { thinkInTheModelInstructions } from './model-questions.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { askTheUserFirst, constructionRecordInstructions, grammarReadingInstructions, modelingSessionInstructions } from './construction-principles.mjs';

export { askTheUserFirst };
import { methodCoreInstructions, modelingWorkflows, purposeInstructions, purposeMethod, workflowForPurpose } from './workflow-guidance.mjs';

export const modelingPurposes = Object.freeze([
  'creative_story',
  'source_reconstruction',
  'person_reflection',
  'observation',
  'forecasting',
  'counterfactual',
  'agent_memory',
  'user_memory',
  'human_author_feedback',
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
  'Read life_construction_replay for history you have not already read, at outline level. When you retain the relevant history and exact known graph head, reuse that reading and inspect only subsequent revisions and relevant records. If saved work may have advanced, establish the intended head and lineage before acting. For unfamiliar history, lost context or an ambiguous branch, read from the start: every model and graph revision with the first line of each note.',
  'Read life_model_outline on the intended graph when its current structure is unfamiliar or has changed; reuse a retained outline at the same exact head.',
  'Open reasoning or full detail, life_narrative_query or life_model_inspect only where you need it, before your first change.',
  'Record consequential findings, changed plans and open questions under your own holder, batching related notes and linking those that build on, answer or replace earlier ones with refines, answers or supersedes. Routine continuation needs no separate reading-plan or compliance record.',
]);

// Compatibility helpers: operational guides are always the entry. Legacy environment or
// caller settings cannot reinstate a paper-reading requirement, and resources are canonical.
export function readingMode() {
  return 'guides';
}

export function servedText(_uri, text) {
  return text;
}

export const modelingTheoryUris = Object.freeze([
  'life-sim://theory/meaning-model',
  'life-sim://theory/life-simulation',
]);

export const modelingFreedom =
  `The modeler chooses the form: processes, categories, relationships and vocabulary fitted to the application, whether adapted from a template or authored directly. The freedom is over form, not over depth. ${thinkInTheModelInstructions} Use the account to compare explanations, explore developments and guide inquiry; develop and revise its categories as part of that work, preserving earlier versions and the applicable validation and authority rules.`;

export const starterSelection =
  'Templates are suggestions: person_scaffold (the Book\'s nine slow processes), change_arc_scaffold and the other starters load structure without semantic scores. Look at them and ask whether what you model is understood better through them, through processes of your own, or through subcategories of either. Story and Decision compilers carry authored numerical meanings and behavioural laws; inspect those assumptions before choosing them.';

export const scaleReview =
  'Start macro to micro: assess the enclosing system and its longer-term developments before selecting local detail. State the focal interval and a useful broader horizon; connect large-scale processes and enduring events to the focal processes through evidenced relationships or explicit hypotheses. Record the assessment in Understanding Nodes, with missing evidence and deliberate scope exclusions. Choose depth and timescales for the question, without a fixed ontology or horizon. A long event alone is not a numerical trend: retain dated process values, their evidence cutoffs and uncertainty. Revisit the broader account when local findings change it.';

export const conceptualReview =
  'Within the agreed delegation, review numerical meaning and conceptual depth without waiting for the user to suggest them. Consider authored judgment scales for relevant meanings, motives, capacities or process changes that are not directly measured; define their comparison, units, anchors and uncertainty, and preserve source measurements separately. Open important concepts into useful parts or alternative lenses using native concepts and abstract cuts, then deepen a child when its label does not explain the relevant behavior or distinction. Assess how meanings differ across dates, actors or contexts; distinguish a changing world from a changed estimate, viewpoint or rubric. Store these assessments as Understanding Nodes linked to the actual definitions and evidence. Revisit them after consequential findings or revisions. Explain adequate boundaries, missing evidence or deliberate exclusions; do not invent scores, change or detail just to fill a checklist. A guess with an honest band, a tag and a reason is not filler: it is how the world is generated.';

const START_HERE_FILE = new URL('../../docs/START_HERE.md', import.meta.url);
// What the Meaning Model is for and how to work in it: served first, in the server instructions, at the head of
// life_modeling_context and as the first required resource, so every agent meets the point before any procedure.
export const startHereText = readFileSync(START_HERE_FILE, 'utf8');

const resourceDefinitions = Object.freeze([
  {
    id: 'start-here',
    uri: 'life-sim://guide/start-here',
    title: 'What the Meaning Model is for, and how to work in it',
    description: 'Read first: the point of the tool, the grammar in brief, how long readings and finer readings relate, the working loop between the world and the writing, and how to tag what is sourced, inferred or invented.',
    mimeType: 'text/markdown',
    file: START_HERE_FILE,
    category: 'protocol',
  },
  {
    id: 'meaning-model-grammar',
    uri: 'life-sim://protocol/grammar',
    title: 'Meaning Model Minimized Grammar',
    description: 'Complete current grammar appendix, with included definitions expanded. Read before modeling; the operational guides map this target contract to the current Rust host.',
    mimeType: 'text/x-tex',
    file: new URL('../../paper/meaning-model-grammar.tex', import.meta.url),
    category: 'protocol',
  },
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
      'Operational modeling contract and entry procedure; the papers are optional references.',
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
    id: 'memory-guide',
    uri: 'life-sim://guide/memory',
    title: 'Agent and User Memory as Continuing Process Models',
    description: 'Scoped, attributed memory that develops ongoing processes through the shared model and Understanding Graph.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/MEMORY.md', import.meta.url),
    category: 'protocol',
  },
  {
    id: 'human-author-feedback-guide',
    uri: 'life-sim://guide/human-author-feedback',
    title: 'Human Authorship with Model-based Feedback',
    description: 'Read-only feedback and human-directed revision using the common construction method without taking over authorship.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/HUMAN_AUTHOR_FEEDBACK.md', import.meta.url),
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
    id: 'book-of-conditions-modeling-example',
    uri: 'life-sim://example/book-of-conditions-modeling',
    title: 'The Book of Conditions: Modeling Lives, Constraints, and Voice',
    description: 'Worked modeling judgments from the Book: concurrent life processes, distinct wants/outlook/appraisal Cuts, independent checking capacity, process-grounded voice, and useful opening or sufficient-here decisions. Its categories are optional.',
    mimeType: 'text/markdown',
    file: new URL('../../docs/examples/BOOK-OF-CONDITIONS-MODELING.md', import.meta.url),
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

async function loadDefinition(definition) {
  const raw = await readFile(definition.file, 'utf8');
  const text = definition.mimeType === 'text/x-tex' ? await expandTexInputs(raw, definition.file) : raw;
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
  return [...resourceDefinitions.filter(({ category }) => category !== 'theory'),
    ...resourceDefinitions.filter(({ category }) => category === 'theory')]
    .map(({ file: _file, ...definition }) => definition);
}

export async function readModelingResource(uri) {
  const definition = byUri.get(uri);
  if (!definition) throw new Error(`Unknown modeling resource ${uri}.`);
  return loadDefinition(definition);
}

// Tool-only MCP hosts can read the same canonical resources without a second
// document copy. Offsets are UTF-16 string positions in the digest-bound text.
export async function readModelingResourcePage({ uri, offset = 0, maxCharacters = 24_000, expectedSha256 }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxCharacters)
    || maxCharacters < 1 || maxCharacters > 64_000) throw new Error('Invalid resource page range.');
  const resource = await readModelingResource(uri);
  if (expectedSha256 && expectedSha256 !== resource.sha256) throw new Error('The resource changed; restart reading from offset 0.');
  if (offset > resource.text.length) throw new Error('Resource page offset is past the end.');
  let end = Math.min(resource.text.length, offset + maxCharacters);
  // Keep surrogate pairs intact when pages are concatenated by clients.
  if (end < resource.text.length && /[\uDC00-\uDFFF]/u.test(resource.text[end]) && /[\uD800-\uDBFF]/u.test(resource.text[end - 1])) end += 1;
  return { ...resource, text: resource.text.slice(offset, end), offset,
    nextOffset: end < resource.text.length ? end : null, totalCharacters: resource.text.length,
    readingVerified: false };
}

function profileUri(purpose) {
  if (purpose === 'agent_memory' || purpose === 'user_memory') return 'life-sim://guide/memory';
  if (purpose === 'human_author_feedback') return 'life-sim://guide/human-author-feedback';
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
}) {
  ensurePurpose(purpose);
  ensureMode(sessionMode);
  const [startHere, grammar, meaning, life, protocol] = await Promise.all([
    readModelingResource('life-sim://guide/start-here'),
    readModelingResource('life-sim://protocol/grammar'),
    readModelingResource('life-sim://theory/meaning-model'),
    readModelingResource('life-sim://theory/life-simulation'),
    readModelingResource('life-sim://protocol/modeling'),
  ]);
  const theoryDigests = {
    meaningModel: meaning.sha256,
    lifeSimulation: life.sha256,
  };
  const theoryReference = 'Optional theory reference: open the relevant section when a rule or distinction needs a fuller explanation. Reading the paper is not a prerequisite for modeling.';
  const selectedProfile = profileUri(purpose);
  const selectedExample = exampleUri(purpose);
  const orderedResources = [
    { uri: startHere.uri, sha256: startHere.sha256, required: true,
      reason: 'Read first, before the grammar: what the tool is for, how long and finer readings relate, and the working loop. Its text also opens this context as startHere. Reuse it while you retain it unchanged.' },
    { uri: grammar.uri, sha256: grammar.sha256, required: true,
      reason: 'Every fresh agent reads the complete grammar before modeling, including delegated agents. Reuse only while the unchanged contents are retained; refresh after changes or loss of context.' },
    {
      uri: protocol.uri,
      sha256: protocol.sha256,
      required: true,
      reason: 'The operational modeling contract and entry procedure. Read on first use or when changed; reuse unchanged guidance that you retain.',
    },
    ...(!selectedProfile ? [{ uri: 'life-sim://guide/general-modeling', required: true, reason: 'General modeling workflow, compact construction, optional Jev estimation and exact review/record boundaries. Reuse unchanged guidance that you retain.' }] : []),
    ...(selectedProfile
      ? [{ uri: selectedProfile, required: true, reason: 'Purpose-specific modeling and output contract. Reuse unchanged guidance that you retain.' }]
      : []),
    { uri: selectedExample, required: true, reason: 'Inspect one worked representation before expanding the model; reuse that reading while it remains applicable and unchanged.' },
    ...(purpose === 'creative_story' ? [{ uri: 'life-sim://example/book-of-conditions-modeling', required: false,
      reason: 'Recommended alongside the representation example: how the Book connects coexisting life processes, wants, outlook, material constraints, and voice, then chooses what to open or leave sufficient.' }] : []),
    { uri: 'life-sim://example/application-categories', required: false, reason: 'Use when choosing a starter or developing and revising application-specific categories.' },
    {
      uri: 'life-sim://protocol/narrative-understanding-graph',
      required: false,
      reason: 'Read before first use of the optional graph-native story, testimony, rendering, or training-export tools.',
    },
    { uri: meaning.uri, sha256: meaning.sha256, required: false, reason: theoryReference },
    { uri: life.uri, sha256: life.sha256, required: false, reason: theoryReference },
  ];
  return {
    // First, so a client that previews only the start of a long result still shows it to an agent that works without stopping.
    askTheUserFirst,
    schema: 'life-sim-modeling-context/v2',
    startHere: startHere.text,
    method: { core: methodCoreInstructions, inThisMode: purposeMethod(purpose) },
    purpose,
    workflow: workflowForPurpose(purpose).id,
    availableWorkflows: modelingWorkflows,
    workflowEntry: workflowForPurpose(purpose),
    purposeInstructions: purposeInstructions(purpose),
    sessionMode,
    sessionGuidance: modelingSessionInstructions,
    grammarInstructions: grammarReadingInstructions,
    modelingFreedom,
    starterSelection,
    scaleReview,
    conceptualReview,
    constructionRecord: constructionRecordInstructions,
    ...(sessionMode === 'continuation' ? { continuation: { steps: continuationSteps, note: 'The record is the earlier agent\'s understanding. Build on it; where you disagree, record why and link it with contradicts or supersedes rather than silently replacing it.' } } : {}),
    paperFirst: false,
    readingMode: readingMode(),
    requiresFullTheoryRead: false,
    theoryDigests,
    theoryAccessGate: {
      requiredUris: [],
      readUris: [],
      satisfied: true,
      enforced: false,
      durableAcrossServerRestart: false,
    },
    comprehensionBoundary: 'The grammar and operational guides are required reading; the full research papers are optional references. Required resources need reading on first use, when changed or when their relevant guidance is no longer retained, not before every reply. The server does not track reading and cannot verify comprehension. Resource digests identify exact bytes, not reading or understanding.',
    orderedResources,
    minimumChecklist: [
      'declare purpose, interval, scope, resolution, and authority',
      'assess the enclosing system and longer-term trends before local detail; link supporting processes/events or record unknowns and justified exclusions in Understanding Nodes',
      'choose application-specific processes and categories; inspect any starter assumptions and omit unnecessary layers',
      'consider authored numerical judgment scales as well as measured values, with explicit meanings and comparison anchors',
      'open important concepts into their dimensions, each a process under the one it divides with values of its own, and record the carve as concepts and abstract cuts; guessed values with honest bands are depth, not filler',
      'fill the coverage report\'s time schedule level by level, with values and series readings, name in each Event\'s process_ids the processes it changes, and give each a value at it',
      'compare dated or perspective-specific meanings and preserve the difference between conceptual change, revised estimates and changed rubrics',
      'identify continuing referents and accepted event history',
      'separate observations, reports, estimates, completions, forecasts, and creative premises',
      'connect earlier and later states through supporting events, reports, or declared laws; distinguish world changes from revised estimates and leave unexplained transitions open',
      'represent observed and estimated trajectories; explore candidate transition laws as explicit hypotheses and test them before relying on their predictions',
      'preserve competing interpretations, uncertainty, provenance, viewpoint, and residuals',
      'test causal use and irrelevant-input stability when causal laws or predictions are introduced, and coarse-fine conservation when a conservative refinement is claimed; apply checks only to the constructs and commitments present',
      'compare alternative decompositions and revise categories when a different account better serves the task',
      'revise explicitly and project only the requested view',
      'describe every Event that carries a Cut, and most other Events, so their numbers mean something',
      'record consequential choices, ideas, predictions and reasons as Understanding Nodes linked to what they concern, and outside reviews under their actual reviewers; recover unfamiliar construction history or changes since the exact head already read before continuing existing work',
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
  });
  const ordered = context.orderedResources
    .map((resource, index) => `${index + 1}. ${resource.uri} (${resource.required ? 'required when new, changed or no longer retained' : 'optional reference'})`)
    .join('\n');
  return [
    `Begin a Meaning Model modeling session. Purpose: ${purpose}. Session mode: ${sessionMode}.`,
    '',
    context.startHere,
    '',
    context.method.core,
    ...(context.method.inThisMode ? ['', `In this mode: ${context.method.inThisMode}`] : []),
    '',
    ...(context.continuation ? ['You are continuing recorded work. Before any change:', ...context.continuation.steps.map((step, index) => `${index + 1}. ${step}`), context.continuation.note, ''] : []),
    context.sessionGuidance,
    '',
    context.modelingFreedom,
    '',
    context.starterSelection,
    '',
    context.scaleReview,
    '',
    context.conceptualReview,
    '',
    context.grammarInstructions,
    'Call life_modeling_context, then read the start-here guide (its text opens this prompt), the grammar, the operational protocol, the guide or profile for your purpose, and a worked example in that order. Use life_modeling_read with nextOffset to finish each resource if direct MCP resource reads are unavailable. Reuse unchanged guidance that you retain; a new conversational reply does not require rereading it or recording that you did so. Refresh guidance when its content changes, your purpose needs an unfamiliar guide, or relevant context has been lost. The full research papers remain optional references for fuller explanations.',
    ordered,
    '',
    'Declare purpose, interval, scope, resolution, authority, and evidence classes. Preserve alternative interpretations; use sampled trajectories where they suffice and label proposed transition functions as hypotheses to explore and test.',
    '',
    constructionRecordInstructions,
    ...(context.purposeInstructions ? ['', 'Apply the shared method within this authority boundary:', context.purposeInstructions] : []),
  ].join('\n');
}
