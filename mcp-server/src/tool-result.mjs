// Leave room for the JSON-RPC envelope below the SDK's default 10 MiB stdio buffer.
// Large results keep their complete structured value, without a second escaped copy in text.
import { jsonWireValue, stringifyJson } from './exact-json.mjs';
import { commitLeanResult, planLeanResult } from './lean-results.mjs';
export const MAX_TOOL_RESULT_BYTES = 9 * 1024 * 1024;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const retrieval = 'For text-only clients, request a smaller projection (life_narrative_query with mode "skeleton" or "neighborhood", or includeContent false), or use life_construction_export with destinationPath to export complete construction history to a file.';

export function toolResult(full) {
  // What the result sends of its fixed guidance is recorded only once it is known to be delivered (lean-results.mjs).
  const plan = planLeanResult(full);
  const value = plan.value;
  const result = { content: [{ type: 'text', text: stringifyJson(value, null, 2) }], structuredContent: jsonWireValue(value) };
  if (bytes(result) <= MAX_TOOL_RESULT_BYTES) {
    commitLeanResult(plan, result.content[0].text.length);
    return result;
  }
  result.content[0].text = `The complete result is in structuredContent. Its duplicate text representation was omitted to stay within the MCP transport limit; no structured data was truncated. ${retrieval}`;
  if (bytes(result) <= MAX_TOOL_RESULT_BYTES) {
    // The agent may see only this note, so the guidance in the structured value does not count as seen.
    commitLeanResult(plan, result.content[0].text.length, { guidance: false });
    return result;
  }
  // Nothing reached the client, so nothing is recorded as sent.
  return {
    isError: true,
    content: [{ type: 'text', text: `The operation returned a result too large for the MCP transport (${bytes(value)} UTF-8 bytes before the response envelope; maximum result size ${MAX_TOOL_RESULT_BYTES} bytes). No partial result is returned. ${retrieval} If this was a write, it may already have completed: inspect the saved state before retrying it.` }],
  };
}
