// Leave room for the JSON-RPC envelope below the SDK's default 10 MiB stdio buffer.
// Large results keep their complete structured value, without a second escaped copy in text; a value larger than one
// message holds is written whole to a file, which the result names (result-files.mjs). No result fails for its size.
import { jsonWireValue, stringifyJson } from './exact-json.mjs';
import { commitLeanResult, planLeanResult } from './lean-results.mjs';
import { writeResultFile } from './result-files.mjs';
export const MAX_TOOL_RESULT_BYTES = 9 * 1024 * 1024;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const retrieval = 'For text-only clients, request a smaller projection (life_narrative_query with mode "skeleton" or "neighborhood", or includeContent false), or use life_construction_export with destinationPath to export complete construction history to a file.';

// Whether a value comes back inline, in one message, rather than as a file; it records nothing.
export function fitsOneMessage(full) {
  return bytes({ content: [{ type: 'text', text: '' }], structuredContent: jsonWireValue(planLeanResult(full).value) }) + 1024 <= MAX_TOOL_RESULT_BYTES;
}

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
  // Larger than one message holds: the whole value goes to a file, and the result says where. The agent reads the
  // guidance in it only if it opens the file, so it does not count as seen.
  const resultFile = writeResultFile(value);
  const note = `The complete result is larger than one message holds (${resultFile.bytes} bytes), so it was written whole to ${resultFile.path} (sha256 ${resultFile.sha256}). Nothing was cut or refused: read that file for the result. A smaller projection fits in a message: life_narrative_query with mode "skeleton" or "neighborhood", or includeContent false; life_meaning_query and life_values_query read parts of a model.`;
  const pointer = { content: [{ type: 'text', text: note }], structuredContent: { resultFile, resultFileNote: note } };
  commitLeanResult(plan, note.length, { guidance: false });
  return pointer;
}
