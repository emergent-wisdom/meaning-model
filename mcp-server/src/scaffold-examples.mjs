// Complete, valid requests for every scaffold kind, from the engine's own example command, which ships with the
// package. A refused request gets the example of its kind, so one refusal shows the whole shape instead of one missing
// field at a time.
import { readFileSync } from 'node:fs';

let cached;
export function scaffoldExampleRequest() {
  if (cached === undefined) {
    try {
      cached = JSON.parse(readFileSync(new URL('../../rust-engine/examples/construction-scaffolds-command.json', import.meta.url), 'utf8')).profile_request ?? null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

export function scaffoldHint(profileRequest) {
  const example = scaffoldExampleRequest();
  if (!example) return null;
  const requested = [...new Set((Array.isArray(profileRequest?.profiles) ? profileRequest.profiles : []).map((item) => item?.kind).filter((kind) => typeof kind === 'string'))];
  const matching = example.profiles.filter((item) => requested.includes(item.kind));
  const shown = matching.length ? matching : example.profiles;
  const shape = `A profile request is { "schema": ${JSON.stringify(example.schema)}, "model": ${JSON.stringify(example.model)}, "profiles": [{ "kind": ..., "profile": { ... } }] }.`;
  return `${matching.length ? '' : `${shape} `}${shown.map((item) => `A complete valid ${item.kind} entry, from the engine's own example: ${JSON.stringify(item)}.`).join(' ')} Adapt it: every field shown is expected, and a referent it names must exist in the same request or model.`;
}
