// What a revision leaves to recheck, through recorded dependencies rather than a semantic verdict on the whole.
// The check follows Cuts conditioned on a revised Cut, draws made from weights that
// have changed, readings and estimates whose Event text changed, later Events a changed one causes, and the passages
// that render a changed record. A reading depends on the text it read; its dependence on the modeled state is not
// tracked until a model needs it.
import { z } from 'zod';
import { eventTextSignature } from './cut-shares.mjs';
import { indexModel } from './model-questions.mjs';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

export const revisionCheckSchema = z.object({
  graphHash: hash, accessScopes: z.array(id).max(64).default([]),
  fromModelHash: hash.describe('The model before the revision, or before a run of revisions.'),
  toModelHash: hash.optional().describe('The revised model; by default the one the graph is bound to.'),
  limit: z.number().int().min(1).max(200).default(40).describe('How many of each kind to list.'),
}).strict();

const weightsOf = (cut) => JSON.stringify((cut?.answers ?? []).map((answer) => [answer.key, +Number(answer.weight).toFixed(6)]).sort());
const causal = new Set(['causes', 'enables', 'prevents', 'constrains', 'realizes_forecast']);
const headingOnlyRoot = (node) => {
  if (node.role !== 'document_root') return false;
  const lines = String(node.text ?? '').split(/\r?\n/u).filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => /^ {0,3}#{1,6}(?:[ \t]+.*)?[ \t]*$/u.test(line));
};

export async function checkRevision(service, raw) {
  const input = revisionCheckSchema.parse(raw);
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: [...new Set(input.accessScopes)].sort() });
  const toHash = input.toModelHash ?? view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
  if (!toHash) throw new Error('The graph is not bound to a model: name the revised model with toModelHash.');
  const [{ model: before }, { model: after }] = await Promise.all([service.inspectModel({ modelHash: input.fromModelHash, includeDefinition: true }), service.inspectModel({ modelHash: toHash, includeDefinition: true })]);
  const a = before.meaning_model ?? {}; const b = after.meaning_model ?? {};
  const eventsA = new Map((a.events ?? []).map((event) => [event.id, event])); const eventsB = new Map((b.events ?? []).map((event) => [event.id, event]));
  const cutsA = new Map((a.normalized_cuts ?? []).map((cut) => [cut.id, cut])); const cutsB = new Map((b.normalized_cuts ?? []).map((cut) => [cut.id, cut]));
  // What the revision changed.
  const rewritten = [...eventsB.values()].filter((event) => eventsA.has(event.id) && eventTextSignature(eventsA.get(event.id)) !== eventTextSignature(event)).map((event) => event.id);
  const retimed = [...eventsB.values()].filter((event) => eventsA.has(event.id) && JSON.stringify(eventsA.get(event.id).interval ?? null) !== JSON.stringify(event.interval ?? null)).map((event) => event.id);
  const removedEvents = [...eventsA.keys()].filter((eventId) => !eventsB.has(eventId));
  const reweighted = [...cutsB.values()].filter((cut) => cutsA.has(cut.id) && weightsOf(cutsA.get(cut.id)) !== weightsOf(cut)).map((cut) => cut.id);
  const withdrawn = [...cutsB.values()].filter((cut) => cut.withdrawn && cutsA.has(cut.id) && !cutsA.get(cut.id).withdrawn).map((cut) => cut.id);
  const removedCuts = [...cutsA.keys()].filter((cutId) => !cutsB.has(cutId));
  const moved = [...cutsB.values()].filter((cut) => cutsA.has(cut.id) && cutsA.get(cut.id).parent_event_id !== cut.parent_event_id).map((cut) => cut.id);
  const changedCuts = new Set([...reweighted, ...withdrawn, ...removedCuts]);
  const changedEvents = new Set([...rewritten, ...retimed, ...removedEvents]);
  // What depended on it.
  const conditioned = [...cutsB.values()].filter((cut) => !cut.withdrawn && cut.conditioning?.cut_id && changedCuts.has(cut.conditioning.cut_id))
    .map((cut) => ({ cutId: cut.id, on: cut.conditioning.cut_id, why: withdrawn.includes(cut.conditioning.cut_id) || removedCuts.includes(cut.conditioning.cut_id) ? 'it is conditioned on a Cut that is gone: withdraw it with its parent or condition it on the new one' : 'the answer it divides changed weight, so its joint shares changed: check it still holds' }));
  // A draw is consistent when its Cut carries the weights it was drawn from, as after a restore.
  const records = (view.nodes ?? []).filter((node) => node.node_type === 'direction_draw').map((node) => { try { const data = JSON.parse(node.text); return data?.cutId ? data : null; } catch { return null; } }).filter(Boolean);
  const draws = records.filter((draw) => changedCuts.has(draw.cutId) || moved.includes(draw.cutId))
    .filter((draw) => !draw.answers || !cutsB.has(draw.cutId) || cutsB.get(draw.cutId).withdrawn || weightsOf(cutsB.get(draw.cutId)) !== weightsOf({ answers: draw.answers }) || moved.includes(draw.cutId))
    .map((draw) => ({ cutId: draw.cutId, realized: draw.realized ?? null, why: moved.includes(draw.cutId) && cutsB.has(draw.cutId) && draw.answers && weightsOf(cutsB.get(draw.cutId)) === weightsOf({ answers: draw.answers })
      ? 'its Cut moved to another Event: re-point the realizes_forecast relation that names it'
      : 'it was drawn from weights that have changed: keep the draw, and mark it as drawn from a superseded state; redraw only if you decide to, as a visible reroll' }));
  const index = indexModel(after);
  const readings = [];
  for (const cut of cutsB.values()) {
    if (cut.withdrawn) continue;
    const text = (cut.provenance ?? []).find((item) => String(item).startsWith('event-text:'))?.slice(11);
    const target = index.readings?.has(cut.parent_event_id) ? (index.relations.find((relation) => relation.source_event_id === cut.parent_event_id && relation.kind === 'about')?.target_event_id ?? cut.parent_event_id) : cut.parent_event_id;
    if (text && changedEvents.has(target) && eventsB.has(target) && text !== eventTextSignature(eventsB.get(target))) readings.push({ cutId: cut.id, eventId: target, why: 'it read the Event\'s text, which has been rewritten' });
  }
  const later = (b.event_relations ?? []).filter((relation) => causal.has(relation.kind) && changedEvents.has(relation.source_event_id) && eventsB.has(relation.target_event_id))
    .map((relation) => ({ eventId: relation.target_event_id, from: relation.source_event_id, relation: relation.kind, why: 'it follows from an Event that changed: check its description and interval still hold' }));
  const anchored = new Map(); const depicted = new Map(); const linked = new Set();
  // Moving a Cut changes what its depiction is about, even when its answer weights stay the same.
  const changedAnchoredCuts = new Set([...changedCuts, ...moved]);
  const addAnchor = (map, nodeId, recordId) => {
    if (!map.has(nodeId)) map.set(nodeId, new Set());
    map.get(nodeId).add(recordId);
  };
  for (const edge of view.edges ?? []) {
    if (edge.source?.kind !== 'node' || edge.target?.kind !== 'anchor') continue;
    const renders = edge.family === 'grounding' && edge.relation === 'renders'
      && ['event', 'normalized_cut'].includes(edge.target.anchor_kind);
    if (renders) linked.add(edge.source.node_id);
    const hit = (edge.target.anchor_kind === 'event' && changedEvents.has(edge.target.anchor_id)) || (edge.target.anchor_kind === 'normalized_cut' && changedAnchoredCuts.has(edge.target.anchor_id));
    if (hit) {
      addAnchor(anchored, edge.source.node_id, edge.target.anchor_id);
      if (renders) addAnchor(depicted, edge.source.node_id, edge.target.anchor_id);
    }
  }
  const nodes = new Map((view.nodes ?? []).map((node) => [node.id, node]));
  const passages = [...depicted].filter(([nodeId]) => nodes.get(nodeId)?.render === 'include').map(([nodeId, records]) => ({ nodeId, records: [...records], why: 'it declares a renders dependency on a record that changed: regenerate it or mark it' }));
  // An about/support/provenance link is not a declaration that this passage depicts its target.
  // A document's Markdown heading names the work; prose on that same root still needs its own grounding.
  const unlinked = (view.nodes ?? []).filter((node) => node.render === 'include' && String(node.text ?? '').trim() && !headingOnlyRoot(node) && !String(node.node_type ?? '').startsWith('understanding.') && !linked.has(node.id)).map((node) => node.id);
  const notes = [...anchored].filter(([nodeId]) => nodes.get(nodeId) && nodes.get(nodeId).render !== 'include' && String(nodes.get(nodeId).node_type ?? '').startsWith('understanding.'))
    .map(([nodeId, records]) => ({ nodeId, records: [...records], why: 'a note about a record that changed: it may describe the old account' }));
  const limit = (list) => list.slice(0, input.limit);
  const toCheck = conditioned.length + draws.length + readings.length + later.length + passages.length + notes.length;
  return {
    schema: 'meaning-model-revision-check/v1', fromModelHash: input.fromModelHash, toModelHash: toHash, graphMutation: false,
    changed: { rewritten: limit(rewritten), retimed: limit(retimed), removedEvents: limit(removedEvents), reweighted: limit(reweighted), withdrawn: limit(withdrawn), removedCuts: limit(removedCuts), moved: limit(moved) },
    toCheck, conditioned: limit(conditioned), draws: limit(draws), readings: limit(readings), later: limit(later), passages: limit(passages), notes: limit(notes),
    ...(unlinked.length ? { unlinkedPassages: { count: unlinked.length, nodeIds: limit(unlinked), why: 'These passages have no declared renders link to an Event or Cut, so this check cannot tell whether they still hold. Link each to the records it depicts with a renders edge (family grounding, an event or normalized_cut anchor).' } } : {}),
    notChecked: 'Whether the prose agrees with its declared dependencies, whether those links cover everything it depicts, and whether the revision gives anyone knowledge they did not then have. Check meaning and disclosures by hand. Graph dependencies are limited to the supplied accessScopes.',
    nextStep: `${toCheck ? 'Bring each into line with the revision, or say why it stands: re-read stale readings (life_lens_reread), re-condition or withdraw children, keep draws as drawn, review affected notes, and regenerate or mark the passages.' : 'No affected declared dependencies were found in the checked records.'}${unlinked.length ? ` ${unlinked.length} passage${unlinked.length === 1 ? ' has' : 's have'} no declared renders link to an Event or Cut, so ${unlinked.length === 1 ? 'it was' : 'they were'} not checked.` : ''}`,
  };
}

export function registerRevisionCheckTools(server, service, { toolResult }) {
  server.registerTool('life_revision_check', {
    description: 'After a revision, inspect recorded dependencies that need review. Given the model before and after, it names detected changes (Events rewritten, retimed or removed; Cuts reweighted, withdrawn, removed or moved), dependent Cuts and draws, stale readings, directly related later Events, passages with grounding/renders links, and notes anchored to changed records. Passages without a declared renders link are unchecked. This does not verify prose meaning, dependency completeness, or character knowledge.',
    inputSchema: revisionCheckSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await checkRevision(service, input)));
}
