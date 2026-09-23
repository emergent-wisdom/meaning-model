import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import { parseEnabledAddons } from './addon-config.mjs';
import { createEstimator, parseEstimatorConfig } from './estimator-config.mjs';
import { registerEstimatorTools } from './estimator-tools.mjs';
import { directionDrawSchema, drawDirection } from './direction-draw.mjs';
import { registerJevProcessEstimationTools } from './jev-process-estimation.mjs';
import { registerGeneralModelingTools } from './general-modeling.mjs';
import { constructionRecordInstructions, registerConstructionRecordTools } from './construction-record.mjs';
import { narrativeRebindSchema, rebindNarrativeGraph } from './narrative-rebind.mjs';
import { narrativeEditSchema, editNarrativeGraph } from './narrative-editing.mjs';
import {
  LifeSimulationService,
  meaningModelCollections,
  serviceLimits,
} from './service.mjs';
import {
  estimationDispositions,
  estimationIntents,
  estimationOperations,
  estimationOutputModes,
  estimationReviewVerdicts,
} from './estimation-exchange.mjs';
import {
  buildModelingContext,
  buildModelingPrompt,
  listModelingResources,
  modelingPurposes,
  modelingSessionModes,
  modelingTheoryUris,
  readingMode,
  readModelingResource,
} from './modeling-guidance.mjs';

const enabledAddons = parseEnabledAddons(process.env.MEANING_MODEL_ADDONS);
const estimator = createEstimator(parseEstimatorConfig(process.env));
const server = new McpServer({
  name: 'meaning-model',
  version: '0.2.1',
});
const service = new LifeSimulationService();
const requestIdSchema = z.string().min(1).max(256);
const handleSchema = z.string().min(1).max(256);
const processIdSchema = z.string().min(1).max(1_024);
const prefixSchema = z.string().min(1).max(256);
const accessedTheoryResources = new Set<string>();
let theoryAccessPurpose: string | null = null;

// Calling life_modeling_context again for the same purpose, for example to check the gate after
// reading, keeps the access record. A different purpose, a new domain, or consequential work
// starts a new record.
function resetTheoryAccessForNewContext(purpose: string, sessionMode: string) {
  const keep = sessionMode === 'repeat_same_domain'
    || (sessionMode === 'first_use' && theoryAccessPurpose === purpose);
  if (!keep) accessedTheoryResources.clear();
  theoryAccessPurpose = purpose;
}

function requireTheoryAccessForProfileCompilation() {
  if (readingMode() === 'guides') return;
  const missing = modelingTheoryUris.filter((uri) => !accessedTheoryResources.has(uri));
  if (missing.length > 0) {
    throw new Error(
      `Paper-first gate: read the complete required theory resources before profile compilation: ${missing.join(', ')}. The access record starts at the most recent life_modeling_context call that began a new record: the first call, a different purpose, or sessionMode new_domain or consequential. Repeating the call for the same purpose, or sessionMode repeat_same_domain, keeps the record. Reads made before the record began are not counted, so call life_modeling_context first and then read both resources. Access is verified only within this live MCP process and does not prove comprehension.`,
    );
  }
}

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

for (const resource of listModelingResources()) {
  server.registerResource(
    resource.id,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async (uri) => {
      const loaded = await readModelingResource(uri.href);
      if (loaded.category === 'theory') accessedTheoryResources.add(loaded.uri);
      return {
        contents: [{
          uri: loaded.uri,
          mimeType: loaded.mimeType,
          text: loaded.text,
          _meta: {
            sha256: loaded.sha256,
            bytes: loaded.bytes,
            category: loaded.category,
          },
        }],
      };
    },
  );
}

server.registerPrompt(
  'life_modeling_start',
  {
    title: readingMode() === 'guides' ? 'Start Meaning Model modeling' : 'Start paper-grounded Meaning Model modeling',
    description: readingMode() === 'guides'
      ? 'Begin with the operational protocol, a purpose-specific profile and an example; the papers carry the reasons behind the rules.'
      : 'Begin with the complete current papers, then use the operational protocol and a purpose-specific profile.',
    argsSchema: z.object({
      purpose: z.enum(modelingPurposes),
      sessionMode: z.enum(modelingSessionModes).default('first_use'),
    }),
  },
  async (input) => ({
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text: await buildModelingPrompt(input) },
    }],
  }),
);

server.registerTool(
  'life_modeling_context',
  {
    description: readingMode() === 'guides'
      ? 'Return the reading order and minimum operational contract for story, person, observation, forecast, reconstruction, or counterfactual modeling: the protocol, the guide or profile, and an example, with the papers as the theory to open where a rule needs its reason.'
      : 'Return the paper-first reading order and minimum operational contract for story, person, observation, forecast, reconstruction, or counterfactual modeling. The live MCP process records access to both complete papers; content digests are provenance only and never replace reading. Calling it again for the same purpose keeps that reading record, so it can be used to check theoryAccessGate; a different purpose, sessionMode new_domain, or sessionMode consequential starts a new record.',
    inputSchema: z.object({
      purpose: z.enum(modelingPurposes),
      sessionMode: z.enum(modelingSessionModes).default('first_use'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => {
    resetTheoryAccessForNewContext(input.purpose, input.sessionMode);
    return toolResult(await buildModelingContext({
      ...input,
      readTheoryUris: [...accessedTheoryResources],
    }));
  },
);

const generalPurposeNote = 'Purpose defaulted to observation; pass purpose to change it. observation keeps each report, estimate and judgment in its own authority, and suits explanatory or retrospective accounts built from records or recalled knowledge. forecasting adds values after the evidence cutoff that later observations can test. counterfactual holds an explicit alternative premise apart from the accepted history.';

server.registerPrompt('life_general_modeling_start', {
  title: 'Build and revise a general-purpose world model',
  description: 'Model macro context and long-term developments before local processes, with optional Jev estimation and automatic graph ingestion. Storytelling is independent and opt-in.',
  argsSchema: z.object({
    purpose: z.enum(['observation', 'forecasting', 'counterfactual']).optional(),
    sessionMode: z.enum(modelingSessionModes).default('first_use'),
    brief: z.string().trim().min(1).max(8_000).optional(),
  }),
}, async ({ purpose, sessionMode, brief }) => ({
  messages: [{ role: 'user' as const, content: { type: 'text' as const, text: [
    await buildModelingPrompt({ purpose: purpose ?? 'observation', sessionMode }),
    purpose ? '' : generalPurposeNote,
    brief ? `User modeling brief: ${brief}` : '',
    'Use life-sim://guide/general-modeling. Reuse the user\'s supplied scope and delegation; establish missing purpose, interval, evidence and retained decisions before substantive modeling. Choose useful processes across the system, not only an outcome such as price.',
    'Before construction, supply contextReview for broaderContext and longerTerm, with focal and broader intervals, assessments and supporting process/event/source references. life_world_model_build returns needs_context_review without a provider call or write when this is missing. Complete the review within the agreed delegation. Unknown context and deliberate scope exclusions require reasons; do not invent history or request a new user checkpoint just to fill the review.',
    'Also complete contextReview.authoredJudgments, conceptualStructure and conceptVariation without waiting for the user to suggest them. Consider defined numerical scales for interpretive judgments, native concepts and abstract cuts for useful decomposition, and dated or perspective-specific meanings. The builder returns needs_modeling_review before estimation or writing when these considerations are absent. Link represented assessments to actual records or explain sufficient boundaries, unknowns and exclusions; do not manufacture scores or depth.',
    'Use life_world_model_build for compact initial construction; life_process_estimate for batched bounded estimates; life_process_estimation_record for exact reviewed graph records and Understanding Nodes. Keep unknown values unknown and source measurements in their actual units. Inspect and revise categories or deepen processes when needed.',
    estimator ? `The configured estimator is ${estimator.label}. It evaluates supplied questions; the calling LLM frames and reviews them. Measure latency and usage; do not assume a speedup.` : 'No external estimator is configured. Use supplied answers or the returned estimation tasks; general modeling works without Jev.',
    'Keep modeling artifacts and substantive assessments in the graph. Recorded numerical estimates are not accepted runtime observations. Automatic storytelling requires its separate opt-in add-on; this general workflow imposes no literary requirements.',
    constructionRecordInstructions,
  ].filter(Boolean).join('\n\n') } }],
}));

server.registerTool(
  'life_profile_compile',
  {
    description: 'Optional shortcut after both complete theory resources have been read in this live MCP process: compile Story, Person, Decision, concept_scaffold, change_arc_scaffold, person_scaffold, thing_scaffold, or relationship_scaffold profiles in Rust into an ordinary revision-0 ModelDefinition. The modeler may instead author a model directly with application-specific categories. Structural starters are unweighted by default; person_scaffold offers lifecycle alone or Book-style processes (the existing default). Story and Decision add experimental numerical meanings and behavioural laws, not universal rules; inspect these assumptions before choosing them. This read-only operation never registers or persists the result. Adapt it before life_model_register, or use an explicit successor revision for later category changes. A complete valid request, model and graph are shown in life-sim://example/minimal-model-and-graph.',
    inputSchema: z.object({
      profileRequest: z.record(z.string(), z.unknown()),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => {
    requireTheoryAccessForProfileCompilation();
    return toolResult(await service.compileProfiles(input));
  },
);

server.registerTool(
  'life_engine_status',
  {
    description: 'Describe the one authoritative Rust machine, its MCP interface, limits, and separately scoped coverage claims.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => toolResult(await service.engineStatus()),
);

server.registerTool(
  'life_model_validate',
  {
    description: 'Validate a complete typed Life Simulation model in Rust without storing it.',
    inputSchema: z.object({
      model: z.record(z.string(), z.unknown()),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.validateModel(input)),
);

server.registerTool(
  'life_model_register',
  {
    description: 'Validate, hash, and store one complete immutable revision-0 typed model in the Rust machine. The result\'s descriptionCoverage lists Events that carry a Cut without a description; give each one, so its numbers mean something, and describe most other Events. requireDescribedNumbers refuses such a model. A complete valid request, model and graph are shown in life-sim://example/minimal-model-and-graph.',
    inputSchema: z.object({
      requestId: requestIdSchema,
      model: z.record(z.string(), z.unknown()),
      requireDescribedNumbers: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.registerModel(input)),
);

server.registerTool(
  'life_model_revise',
  {
    description: 'Register a complete immutable successor model revision. Added dimensions and laws are schema changes, never in-place patches. The result\'s worldAdoption lists changes that a world on the parent revision cannot adopt through life_world_revise: a removed process, or a changed value type, axes, unit, reference frame or scale (the scale holds the process meaning). requireWorldAdoptable refuses such a revision before registering it. descriptionCoverage lists Events that carry a Cut without a description, and requireDescribedNumbers refuses them.',
    inputSchema: z.object({
      requestId: requestIdSchema,
      previousModelHash: z.string().length(64),
      model: z.record(z.string(), z.unknown()),
      requireWorldAdoptable: z.boolean().default(false),
      requireDescribedNumbers: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.reviseModel(input)),
);

server.registerTool(
  'life_model_inspect',
  {
    description: 'Inspect a Rust-stored typed model summary. includeDefinition is an administrative operation: it returns the bounded complete definition, including process initial values, and must be protected by authentication/authorization outside this local MCP service.',
    inputSchema: z.object({
      modelHash: z.string().length(64),
      includeDefinition: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.inspectModel(input)),
);

server.registerTool(
  'life_meaning_query',
  {
    description: 'Read a bounded page of authored concepts, abstract relations or cuts, referents, encapsulation cuts, events, event-referent bindings, physical cuts, and realization records from an optional Rust-stored Meaning Model layer. Filters are exact ids; this static administrative view of semantic data does not infer links, execute semantic records, apply cuts, or mutate the model, and must be protected by authentication/authorization outside this local MCP service.',
    inputSchema: z.object({
      modelHash: z.string().length(64),
      collections: z.array(z.enum(meaningModelCollections))
        .min(1)
        .max(meaningModelCollections.length)
        .default([...meaningModelCollections]),
      ids: z.array(z.string().min(1).max(serviceLimits.maxQueryStringLength))
        .max(serviceLimits.maxMeaningQueryIds)
        .default([]),
      offset: z.number().int().nonnegative()
        .max(serviceLimits.maxMeaningQueryOffset)
        .default(0),
      limit: z.number().int().positive()
        .max(serviceLimits.maxMeaningQueryItems)
        .default(100),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.queryMeaningModel(input)),
);

server.registerTool(
  'life_estimation_request_create',
  {
    description: 'Create an immutable provider-neutral estimation request bound to one exact Rust model revision and accepted world head. The request exposes only the requested Rust-enforced projection and distinguishes assimilate, estimate, predict, infer, counterfactual, or simulate from reality versus creative intent.',
    inputSchema: z.object({
      worldId: handleSchema,
      requestId: requestIdSchema,
      operation: z.enum(estimationOperations),
      intent: z.enum(estimationIntents),
      evidenceCutoff: z.number().finite(),
      coordinates: z.array(z.object({
        id: handleSchema,
        processId: processIdSchema,
        targetTime: z.number().finite().optional(),
        question: z.string().min(1).max(4_000).optional(),
      })).min(1).max(serviceLimits.maxEstimationCoordinates),
      accessScopes: z.array(processIdSchema).max(64).default([]),
      context: z.string().max(serviceLimits.maxEstimationContextLength).default(''),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.createEstimationRequest(input)),
);

server.registerTool(
  'life_estimation_response_submit',
  {
    description: 'Validate a provider response that disposes every requested coordinate exactly once as known, unknown, or unmodeled. Known coordinates require typed provisional Rust claims with uncertainty, provenance, authority, and evidence cutoff. A data-only response may omit proposedModel and proposalReason. Any semantic change requires a complete proposed successor ModelDefinition and reason, which Rust validates. This tool stores only an uncommitted proposal and never rolls, commits, mutates a world, or registers a revision.',
    inputSchema: z.object({
      estimationRequestId: handleSchema,
      requestId: requestIdSchema,
      dispositions: z.array(z.object({
        coordinateId: handleSchema,
        status: z.enum(estimationDispositions),
        reason: z.string().min(1).max(serviceLimits.maxEstimationReasonLength),
      })).min(1).max(serviceLimits.maxEstimationCoordinates),
      provisionalClaims: z.array(z.object({
        coordinateId: handleSchema,
        outputMode: z.enum(estimationOutputModes),
        valueTime: z.number().finite(),
        claim: z.record(z.string(), z.unknown()),
        acknowledgedClaimIds: z.array(processIdSchema)
          .max(serviceLimits.maxProvisionalClaims)
          .default([]),
      })).max(serviceLimits.maxProvisionalClaims).default([]),
      semanticChanges: z.array(z.object({
        collection: z.enum(meaningModelCollections),
        action: z.enum(['add', 'replace', 'remove']),
        id: processIdSchema,
        definition: z.record(z.string(), z.unknown()).optional(),
        reason: z.string().min(1).max(serviceLimits.maxEstimationReasonLength),
      })).max(serviceLimits.maxSemanticChanges).default([]),
      proposedModel: z.record(z.string(), z.unknown()).optional(),
      proposalReason: z.string().min(1).max(serviceLimits.maxEstimationReasonLength).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.submitEstimationResponse(input)),
);

server.registerTool(
  'life_estimation_proposal_inspect',
  {
    description: 'Inspect an immutable uncommitted estimation proposal. For proposals that include semantic model changes, includeProposedModel returns the complete administrative model definition needed for an explicit later life_model_revise call; data-only proposals contain no model. Protect model output with external authorization.',
    inputSchema: z.object({
      proposalId: handleSchema,
      includeProposedModel: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.inspectEstimationProposal(input)),
);

server.registerTool(
  'life_estimation_proposal_review',
  {
    description: 'Record an immutable explicit review. Approval is refused if the bound world head is stale. Proposals containing a model are revalidated in Rust and return a separate life_model_revise step; data-only proposals have no model-registration step. Approved observed outputs return an exact forward ModelTransitionSpec observation fragment. Review itself never rolls, commits, registers, or mutates.',
    inputSchema: z.object({
      proposalId: handleSchema,
      requestId: requestIdSchema,
      verdict: z.enum(estimationReviewVerdicts),
      rationale: z.string().min(1).max(serviceLimits.maxEstimationReasonLength),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.reviewEstimationProposal(input)),
);

server.registerTool(
  'life_world_create',
  {
    description: 'Create an isolated continuous world from a Rust-stored modelHash, or omit modelHash to use an explicitly selected or default approved preset. presetId and modelHash are mutually exclusive.',
    inputSchema: z.object({
      requestId: requestIdSchema,
      presetId: z.enum(['north-harbor/12', 'north-harbor/48']).optional(),
      modelHash: z.string().length(64).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.createWorld(input)),
);

server.registerTool(
  'life_world_refine_genesis',
  {
    description: 'Replace an untouched Rust genesis world with an already registered direct-next model revision that preserves every existing process, edge, law, initial claim, and Meaning Model record exactly and may add authored detail. This is a genesis-only canonical mutation, not automatic discovery, cut execution, adaptive opening, or post-history migration.',
    inputSchema: z.object({
      worldId: handleSchema,
      requestId: requestIdSchema,
      targetModelHash: z.string().length(64),
      requestedObservables: z.array(processIdSchema).max(1_000).default([]),
      accessScopes: z.array(processIdSchema).max(64).default([]),
      includePath: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.refineGenesisWorld(input)),
);

server.registerTool(
  'life_world_inspect',
  {
    description: 'Inspect one canonical world head without changing it.',
    inputSchema: z.object({ worldId: handleSchema }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.inspectWorld(input)),
);

server.registerTool(
  'life_world_revise',
  {
    description: 'Adopt a registered direct-next model revision at the current world time, including after accepted history. Requires the exact expected world hash. refine preserves existing records and state; revise explicitly permits compatible authored changes. Supply current values for every new process. Prior history and narrative sources remain frozen; old candidates cannot be accepted against the new head. This is an authored revision, not a simulated event or inferred migration.',
    inputSchema: z.object({
      worldId: handleSchema,
      requestId: requestIdSchema,
      expectedWorldHash: z.string().length(64),
      targetModelHash: z.string().length(64),
      mode: z.enum(['refine', 'revise']),
      stateValues: z.record(z.string(), z.unknown()).default({}),
      reason: z.string().min(1).max(1_024),
      provenance: z.array(z.string().min(1).max(1_024)).min(1).max(64),
      requestedObservables: z.array(processIdSchema).max(1_000).default([]),
      accessScopes: z.array(processIdSchema).max(64).default([]),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.reviseWorld(input)),
);

server.registerTool(
  'life_world_revision_inspect',
  {
    description: 'Read a persisted authored world-revision receipt by its immutable hash. Frozen state is projected through requestedObservables and accessScopes; an empty request returns no state. This remains a trusted authoring session, not an authentication boundary.',
    inputSchema: z.object({
      revisionHash: z.string().length(64),
      requestedObservables: z.array(processIdSchema).max(1_000).default([]),
      accessScopes: z.array(processIdSchema).max(64).default([]),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.inspectWorldRevision(input)),
);

server.registerTool(
  'life_view_query',
  {
    description: 'Query an explicit Rust-enforced projection of a canonical world or candidate. Empty requestedObservables returns metadata with no state; accessScopes are an access context, not authentication.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema.optional(),
      requestedObservables: z.array(processIdSchema).max(1_000).default([]),
      accessScopes: z.array(processIdSchema).max(64).default([]),
      includePath: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.queryView(input)),
);

const graphSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('model'), modelHash: z.string().length(64) }),
  z.object({ kind: z.literal('world'), worldId: handleSchema }),
  z.object({ kind: z.literal('candidate'), candidateHash: z.string().length(64) }),
]);

server.registerTool(
  'life_graph_query',
  {
    description: 'Read the canonical Rust causal factor graph as a full immutable snapshot, a compact whole-graph skeleton, or a bounded neighborhood with every crossing edge and endpoint preserved. Neighborhoods are views and never replace or mutate the complete graph.',
    inputSchema: z.object({
      source: graphSourceSchema,
      mode: z.enum(['full', 'skeleton', 'neighborhood']),
      centerNodeId: z.string().min(1).max(1_024).nullable().default(null),
      depth: z.number().int().min(0).max(serviceLimits.maxGraphNeighborhoodDepth).default(1),
      direction: z.enum(['ancestors', 'descendants', 'both']).default('both'),
      includeValues: z.boolean().default(false),
      accessScopes: z.array(processIdSchema)
        .max(serviceLimits.maxViewAccessScopes)
        .default([]),
      expectedSnapshotHash: z.string().length(64).nullable().default(null),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.queryGraph(input)),
);

server.registerTool(
  'life_narrative_register',
  {
    description: 'Register a complete immutable revision-0 graph-native story/understanding artifact in the Rust authority. Story passages remain canonical nodes, externalized reflections remain distinct scope-guarded testimony, and typed edges may target stable model objects or validated nested subpaths. Read life-sim://protocol/narrative-understanding-graph before first use. This layer is optional and does not mutate the bound world. A complete valid request, model and graph are shown in life-sim://example/minimal-model-and-graph.',
    inputSchema: z.object({
      requestId: requestIdSchema,
      narrativeGraph: z.record(z.string(), z.unknown()),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.registerNarrativeGraph(input)),
);

server.registerTool(
  'life_narrative_revise',
  {
    description: 'Register one immutable successor of a Rust-owned narrative/understanding graph, from either its complete definition (narrativeGraph) or its change from the predecessor (change): new or replaced nodes and edges, removed ids, and optionally new roots or a new source. Send the change for a large graph; the engine applies it to the stored predecessor, refuses it unless accessScopes reveal the whole predecessor, and validates the successor as a complete revision. Earlier text and testimony revisions remain addressable; no in-place overwrite occurs and the simulation world remains unchanged. The contract is documented at life-sim://protocol/narrative-understanding-graph.',
    inputSchema: z.object({
      requestId: requestIdSchema,
      previousGraphHash: z.string().length(64),
      narrativeGraph: z.record(z.string(), z.unknown()).optional().describe('The complete successor definition.'),
      change: z.object({
        revision: z.object({
          number: z.number().int().positive(),
          previous_graph_hash: z.string().length(64),
          reason: z.string().trim().min(1),
          provenance: z.array(z.string().trim().min(1)).min(1),
        }).strict(),
        source: z.record(z.string(), z.unknown()).optional(),
        roots: z.array(z.string()).optional(),
        upsertNodes: z.array(z.record(z.string(), z.unknown())).optional(),
        removeNodeIds: z.array(z.string()).optional(),
        upsertEdges: z.array(z.record(z.string(), z.unknown())).optional(),
        removeEdgeIds: z.array(z.string()).optional(),
      }).strict().optional().describe('The successor as its change from the predecessor, instead of narrativeGraph.'),
      accessScopes: z.array(z.string()).max(64).optional().describe('With change: scopes that reveal every node, edge and root of the predecessor.'),
    }).refine((input) => Boolean(input.narrativeGraph) !== Boolean(input.change), 'Send exactly one of narrativeGraph or change.'),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ change, accessScopes, ...input }) => toolResult(change
    ? await service.reviseNarrativeGraphByDelta({ requestId: input.requestId, previousGraphHash: input.previousGraphHash, delta: change, accessScopes: accessScopes ?? [] })
    : await service.reviseNarrativeGraph(input)),
);

server.registerTool(
  'life_narrative_batch',
  {
    description: 'Atomically add one or many roots, nodes, and edges to an immutable Rust narrative/understanding graph. Rust creates a complete successor revision. On a nonempty graph every new-node component must connect in this same batch to an existing narrative node or validated stable anchor; a one-node batch is therefore valid when it includes that connection. The payload is {schema: life-sim-rust-narrative-batch/v1, previous_graph_hash, reason, provenance, add_roots, add_nodes, add_edges}; a complete, test-verified example is in life-sim://example/minimal-model-and-graph. Read life-sim://protocol/narrative-understanding-graph before first use.',
    inputSchema: z.object({
      requestId: requestIdSchema,
      previousGraphHash: z.string().length(64),
      narrativeBatch: z.record(z.string(), z.unknown()),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.applyNarrativeBatch(input)),
);

server.registerTool(
  'life_narrative_edit',
  {
    description: 'Atomically split, merge, move, reorder or edit existing narrative/understanding graph passages. Available for any modeled domain, without the storytelling add-on. Supply the exact predecessor graphHash, scopes covering its complete graph, a reason and ordered operations; the service preserves untouched records and constructs one immutable Rust-validated successor. Splits preserve exact rendered text. Existing testimony and model anchors are not automatically reinterpreted; inspect affected review IDs and re-review changed text or order. Read life-sim://protocol/narrative-understanding-graph for operation contracts and conservative topology limits.',
    inputSchema: narrativeEditSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await editNarrativeGraph(service, input)),
);

server.registerTool(
  'life_narrative_query',
  {
    description: 'Read an optional Rust-owned graph-native story/understanding artifact as a full graph, compact skeleton, or bounded neighborhood. Content and incident edges are removed when access scopes do not permit the node or edge; scopes are projection labels rather than authentication.',
    inputSchema: z.object({
      graphHash: z.string().length(64),
      mode: z.enum(['full', 'skeleton', 'neighborhood']),
      includeContent: z.boolean().default(false),
      centerNodeId: z.string().min(1).max(1_024).nullable().default(null),
      depth: z.number().int().min(0).max(serviceLimits.maxGraphNeighborhoodDepth).default(1),
      direction: z.enum(['ancestors', 'descendants', 'both']).default('both'),
      accessScopes: z.array(processIdSchema)
        .max(serviceLimits.maxViewAccessScopes)
        .default([]),
      expectedGraphHash: z.string().length(64).nullable().default(null),
      forRevision: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.queryNarrativeGraph(input)),
);

server.registerTool(
  'life_narrative_render',
  {
    description: 'Render ordered story text from canonical Rust narrative nodes. The returned document is a projection with contributing node and content hashes; externalized reflections never render and no second story authority is created.',
    inputSchema: z.object({
      graphHash: z.string().length(64),
      rootIds: z.array(processIdSchema).max(serviceLimits.maxNarrativeRoots).default([]),
      accessScopes: z.array(processIdSchema)
        .max(serviceLimits.maxViewAccessScopes)
        .default([]),
      expectedGraphHash: z.string().length(64).nullable().default(null),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.renderNarrativeGraph(input)),
);

server.registerTool(
  'life_narrative_training_export',
  {
    description: 'Export deterministic text↔semantic-state records from a frozen Rust narrative graph and its exact model/world/candidate snapshot. These are single-snapshot alignments, not proof of cutoff-safe chronological order; causal training needs separately time-bound snapshots or a downstream mask. The tool performs no training. Externalized testimony is explicit content—not hidden chain-of-thought.',
    inputSchema: z.object({
      graphHash: z.string().length(64),
      nodeIds: z.array(processIdSchema).max(serviceLimits.maxNarrativeNodes).default([]),
      accessScopes: z.array(processIdSchema)
        .max(serviceLimits.maxViewAccessScopes)
        .default([]),
      includeLinkedValues: z.boolean().default(true),
      requireAcceptedHistory: z.boolean().default(false),
      expectedGraphHash: z.string().length(64).nullable().default(null),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.exportNarrativeTraining(input)),
);

server.registerTool(
  'life_candidate_roll',
  {
    description: 'Roll one complete, noncanonical successor from the current frozen head. It does not commit.',
    inputSchema: z.object({
      worldId: handleSchema,
      requestId: requestIdSchema,
      deltaTime: z.number().positive().max(30).default(0.25),
      stepSize: z.number().positive().max(30).default(1 / 24),
      seed: z.string().min(1).max(1_024).default('life-simulation-mcp'),
      forcingEnabled: z.boolean().default(true),
      query: z.record(z.string(), z.unknown()).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.rollCandidate(input)),
);

server.registerTool(
  'life_candidate_reroll',
  {
    description: 'Increment rollIndex and reroll all declared stochastic streams from exactly the same frozen parent and deterministic inputs.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      requestId: requestIdSchema,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.rerollCandidate(input)),
);

server.registerTool(
  'life_candidate_reject',
  {
    description: 'Reject one complete pending Rust candidate without changing the accepted world head.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      requestId: requestIdSchema,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.rejectCandidate(input)),
);

server.registerTool(
  'life_candidate_observe',
  {
    description: 'Mechanically summarize only the Rust-projected fields retained on an uncommitted candidate, without writing a story.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      fieldPrefixes: z.array(prefixSchema).max(20).default([]),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.observeCandidate(input)),
);

server.registerTool(
  'life_candidate_compare',
  {
    description: 'Compare two candidate endpoints and report whole-state divergence.',
    inputSchema: z.object({
      worldId: handleSchema,
      firstCandidateId: handleSchema,
      secondCandidateId: handleSchema,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.compareCandidates(input)),
);

server.registerTool(
  'life_trajectory_query',
  {
    description: 'Return a filtered and downsampled trajectory from the candidate projection already enforced by Rust. Large full paths remain outside normal tool output.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      fieldPrefixes: z.array(prefixSchema).max(20).default([]),
      sampleEvery: z.number().int().positive().max(10_000).default(1),
      maxFields: z.number().int().positive().max(100).default(25),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.queryTrajectory(input)),
);

server.registerTool(
  'life_trajectory_summarize',
  {
    description: 'Compute a canonical Rust-owned piecewise-linear summary over a retained candidate subinterval. This is read-only and requires a full or decimated path.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      startTime: z.number().finite(),
      endTime: z.number().finite(),
      fields: z.array(processIdSchema).min(1).max(serviceLimits.maxTrajectoryFields),
      accessScopes: z.array(processIdSchema).max(serviceLimits.maxViewAccessScopes).default([]),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.summarizeTrajectory(input)),
);

server.registerTool(
  'life_candidate_annotate',
  {
    description: 'Append a plausibility judgment to the evaluation ledger without changing candidate or world canon.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      requestId: requestIdSchema,
      verdict: z.enum(['plausible', 'implausible', 'uncertain']),
      issues: z.array(z.object({
        fieldId: processIdSchema.optional(),
        code: z.string().min(1).max(128),
        explanation: z.string().min(1).max(2_000),
      })).max(100).default([]),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.annotateCandidate(input)),
);

server.registerTool(
  'life_candidate_route',
  {
    description: 'Rank scope-checked scalar projections of two or more pending candidates that share one frozen parent, interval, and dynamics. The result is advisory: it neither selects an in-world action nor accepts canon.',
    inputSchema: z.object({
      worldId: handleSchema,
      requestId: requestIdSchema,
      candidateIds: z.array(handleSchema)
        .min(2)
        .max(serviceLimits.maxRouteCandidates),
      terms: z.array(z.object({
        termId: z.string().min(1).max(256),
        fieldId: processIdSchema,
        source: z.enum(['endpoint', 'change']),
        preference: z.enum(['maximize', 'minimize', 'target']),
        weight: z.number().positive().max(1_000),
        target: z.number().finite().optional(),
      })).min(1).max(serviceLimits.maxRouteTerms),
      accessScopes: z.array(processIdSchema)
        .max(serviceLimits.maxViewAccessScopes)
        .default([]),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.routeCandidates(input)),
);

server.registerTool(
  'life_candidate_accept',
  {
    description: 'Atomically accept exactly one immutable complete candidate if its frozen parent is still the current head. This is consequential and should receive explicit human confirmation.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      requestId: requestIdSchema,
      expectedParentHash: z.string().length(64),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.acceptCandidate(input)),
);

server.registerTool(
  'life_writer_contract_create',
  {
    description: 'Create a bounded writer constraint contract from one Rust-committed candidate. It cannot mutate canon.',
    inputSchema: z.object({
      worldId: handleSchema,
      candidateId: handleSchema,
      requestId: requestIdSchema,
      brief: z.string().min(1).max(10_000),
      fields: z.array(z.object({
        fieldId: processIdSchema,
        status: z.enum(['hard', 'soft', 'optional', 'renegotiable']),
        causallyRelevant: z.boolean().default(true),
      })).min(1).max(100),
      graph: z.object({
        focusFieldId: processIdSchema.optional(),
        depth: z.number().int().min(0).max(serviceLimits.maxGraphNeighborhoodDepth).default(2),
        direction: z.enum(['ancestors', 'descendants', 'both']).default('both'),
        accessScopes: z.array(processIdSchema)
          .max(serviceLimits.maxViewAccessScopes)
          .default([]),
      }).nullable().default(null),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.createWriterContract(input)),
);

server.registerTool(
  'life_writer_plan_evaluate',
  {
    description: 'Validate a structured writer disposition plan. Hard-field conflicts block rendering; renegotiation returns a model-revision-and-rerun request rather than changing canon.',
    inputSchema: z.object({
      worldId: handleSchema,
      contractId: handleSchema,
      requestId: requestIdSchema,
      dispositions: z.array(z.object({
        fieldId: processIdSchema,
        disposition: z.enum([
          'explicit_dramatization',
          'implicit_adherence',
          'omit_surface_prose',
          'conflict_detected',
          'request_profile_revision',
        ]),
        explanation: z.string().max(2_000).default(''),
      })).min(1).max(100),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.evaluateWriterPlan(input)),
);

const revisionCitationSchema = z.object({
  source: z.enum([
    'reader_observation',
    'story',
    'writer_packet',
    'cut',
    'trajectory',
    'model',
    'test_result',
  ]),
  reference: z.string().min(1).max(1_000),
  note: z.string().min(1).max(4_000),
});

const revisionLayerEvidenceSchema = z.object({
  status: z.enum(['sufficient', 'insufficient', 'unknown']),
  finding: z.string().min(1).max(4_000),
  citations: z.array(revisionCitationSchema).max(50),
});

server.registerTool(
  'life_story_revision_diagnose',
  {
    description: 'Localize a cited story problem to the least foundational supported layer—model, cut, trajectory, or rendering—without rewriting prose, mutating canon, or pretending to measure literary quality.',
    inputSchema: z.object({
      diagnosisId: z.string().min(1).max(200),
      authority: z.object({
        modelHash: z.string().length(64),
        cutHash: z.string().length(64),
        trajectoryHash: z.string().length(64),
        writerPacketHash: z.string().length(64),
        storyHash: z.string().length(64),
      }),
      readerObservations: z.array(z.object({
        observationId: z.string().min(1).max(200),
        statement: z.string().min(1).max(4_000),
        epistemicStatus: z.enum(['reader_report', 'mechanical_observation']),
        citation: z.object({
          sceneId: z.string().min(1).max(500),
          excerpt: z.string().min(1).max(4_000),
        }),
      })).min(1).max(100),
      layerEvidence: z.object({
        model: revisionLayerEvidenceSchema,
        cut: revisionLayerEvidenceSchema,
        trajectory: revisionLayerEvidenceSchema,
        rendering: revisionLayerEvidenceSchema,
      }),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await service.diagnoseStoryRevision(input)),
);

server.registerTool(
  'life_narrative_rebind',
  {
    description: 'Rebind a model-bound narrative graph to a successor model revision as one complete immutable graph revision. Reads the whole graph with the supplied scopes, refuses partial projections and unrelated models, keeps every node including historical assessments, drops only edges anchored to predecessor model hashes, and submits the successor through the existing revise operation. Record fresh depth assessments against the new model before committing further prose.',
    inputSchema: narrativeRebindSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => toolResult(await rebindNarrativeGraph(service, input)),
);

registerEstimatorTools(server, service, estimator, { toolResult });

server.registerTool(
  'life_direction_draw',
  {
    description: 'Draw one answer from a registered model\'s normalized Cut, typically a direction Cut over mutually exclusive continuations, with a recorded seed. The server computes u as the first 32 bits of SHA-256(seed) divided by 2^32 and takes the answer whose cumulative interval, in model order, contains u. With record, the draw is stored in a graph bound to that model, and any earlier draw over the same Cut is reported and linked, so a second draw is visible as a reroll rather than a silent replacement. A drawn remainder calls for a new admissible continuation, not renormalization of the named answers. The draw decides nothing by itself: build and accept the realized continuation through the ordinary model and narrative tools.',
    inputSchema: directionDrawSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => toolResult(await drawDirection(service, input)),
);
registerJevProcessEstimationTools(server, service, estimator, { toolResult });
registerGeneralModelingTools(server, service, estimator, { toolResult });
registerConstructionRecordTools(server, service, { toolResult });

if (enabledAddons.includes('storytelling')) {
  const { registerStorytellingAddon } = await import('./storytelling-addon.mjs');
  await registerStorytellingAddon(server, service);
}
if (enabledAddons.includes('alien')) {
  const { registerAlienAddon } = await import('./alien-addon.mjs');
  registerAlienAddon(server, service, { estimator });
}

await service.initialize();
const transport = new StdioServerTransport();
await server.connect(transport);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await service.close();
}
process.stdin.once('end', close);
process.once('SIGINT', async () => { await close(); process.exit(0); });
process.once('SIGTERM', async () => { await close(); process.exit(0); });
