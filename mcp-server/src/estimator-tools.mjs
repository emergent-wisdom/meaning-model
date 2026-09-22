import * as z from 'zod/v4';
import { alignmentAuditSchema, prepareAlignmentAudit } from './alignment-audit.mjs';
import { cutSharesSchema, proposeCutShares } from './cut-shares.mjs';
import { ingestSchema, ingestSituation } from './situation-ingest.mjs';

export function registerEstimatorTools(server, service, estimator, { toolResult }) {
  const mode = estimator ? `An external estimator is configured (${estimator.label}); the supplied text is sent to that service and scored there. ` : 'No external estimator is configured; the tool returns the generated questions as a task for you, the calling LLM. Set MEANING_MODEL_ESTIMATOR=typesafe with TYPESAFE_API_KEY to score them externally. ';
  server.registerTool('life_estimate_cut_shares', {
    description: `Propose normalized Cut weights for one comparison question across several described situations. ${mode}Each proposal is a choice distribution over your answer keys plus an automatic remainder, returned as a ready-to-place normalized Cut with estimator provenance. Proposals are AI inference, not canon: review them and treat a large remainder as a missing category. Targets may be free-text situations or event IDs in a bound model (modelHash), whose boundary and description supply the situation text. With apply and requestId the tool builds the Cuts under their parent events and registers one complete immutable model revision itself, with estimator provenance; add rebind to move a model-bound story graph to that revision in the same call. You may also pass your own distributions to be placed without an estimator. Without apply nothing is written.`,
    inputSchema: cutSharesSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await proposeCutShares(input, estimator, service)));
  server.registerTool('life_narrative_alignment_audit', {
    description: `Audit rendered narrative text under a root against the graph's records, per passage and as a whole. ${mode}Questions are generated mechanically: for each record, whether the text narrates it and whether it contradicts it; for each withheld node, whether it leaks to the named audience; plus one advisory holistic question. Passage-level flags at or above 0.5 are the actionable signal; whole-unit scores arbitrate proposals and reported speech. List knowledgeStateNodeIds for records phrased as transient knowledge states so they are checked only for narration and leaks, not contradiction. Advisory: with record the tool stores the scores and flags itself as a derived-diagnostic metadata node under the document root; otherwise store findings with life_story_author_record. Resolve flags by revising prose, revising a record with justification, or recording a declared ambiguity.`,
    inputSchema: alignmentAuditSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await prepareAlignmentAudit(service, input, estimator)));
  server.registerTool('life_model_ingest', {
    description: `Ingest a described situation into a bound model in one call. ${mode}You supply the event boundary and description text once, the questions to ask about each event with their answer keys, and optional notes; the tool creates the events under their parent, asks each question for each event, writes every answer distribution as a normalized Cut with an automatic remainder, and with apply registers one complete immutable model revision carrying estimator provenance. With graph it rebinds a model-bound narrative graph to the new revision and stores the notes as Understanding Nodes anchored to the events. Existing events may be revised only with replaceExisting. Descriptions and notes are yours; weights are AI inference; nothing is verified truth.`,
    inputSchema: ingestSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await ingestSituation(input, estimator, service)));
}
