import * as z from 'zod/v4';
import { alignmentAuditSchema, prepareAlignmentAudit } from './alignment-audit.mjs';
import { cutSharesSchema, proposeCutShares } from './cut-shares.mjs';

export function registerEstimatorTools(server, service, estimator, { toolResult }) {
  const mode = estimator ? `An external estimator is configured (${estimator.label}); the supplied text is sent to that service and scored there. ` : 'No external estimator is configured; the tool returns the generated questions as a task for you, the calling LLM. Set MEANING_MODEL_ESTIMATOR=typesafe with TYPESAFE_API_KEY to score them externally. ';
  server.registerTool('life_estimate_cut_shares', {
    description: `Propose normalized Cut weights for one comparison question across several described situations. ${mode}Each proposal is a choice distribution over your answer keys plus an automatic remainder, returned as a ready-to-place normalized Cut with estimator provenance. Proposals are AI inference, not canon: review them, treat a large remainder as a missing category, then place accepted Cuts in an explicit model revision or use them as exploration baselines.`,
    inputSchema: cutSharesSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await proposeCutShares(input, estimator)));
  server.registerTool('life_narrative_alignment_audit', {
    description: `Audit rendered narrative text under a root against the graph's records, per passage and as a whole. ${mode}Questions are generated mechanically: for each record, whether the text narrates it and whether it contradicts it; for each withheld node, whether it leaks to the named audience; plus one advisory holistic question. Passage-level flags at or above 0.5 are the actionable signal; whole-unit scores arbitrate proposals and reported speech. Read-only and advisory; store findings with life_story_author_record or the narrative tools, and resolve them by revising prose, revising a record with justification, or recording a declared ambiguity.`,
    inputSchema: alignmentAuditSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: Boolean(estimator) },
  }, async (input) => toolResult(await prepareAlignmentAudit(service, input, estimator)));
}
