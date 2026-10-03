// What a revision leaves to recheck, through recorded dependencies rather than a semantic verdict on the whole.
// The check follows Cuts conditioned on a revised Cut, draws made from weights that
// have changed, readings and estimates whose Event text changed, later Events a changed one causes, and the passages
// that render a changed record, including its declared region or substrate. A reading depends on the text it read;
// its dependence on the modeled state is not tracked until a model needs it. Assessments about a changed Event are
// listed for review: the Book's revision 14 rewrote Events that 27 untracked assessment Cuts read, and none was named.
// A Cut may also record what it read (reading-evidence.mjs), and those reads are compared on every check. Telling
// phases record the passages they were read against, so a phase whose passages or reading order changed is listed on
// every check until it is renewed: the Book's revision 15 changed passages under nine phases, and none was named.
// Numbers change an Event without touching its text: a comparison (a Cut's weights), or a value on a defined scale, such
// as a rating. A value on a scale has two kinds of record, kept apart as the engine keeps them. A process's state is
// its own declared record (initial value, bounds, unit, update mode, rubric). Claims are attributed accounts of its
// value: a report, a belief, an estimate or a canon, each held by someone with an evidence cutoff; no account overrides
// the state or another account. A changed Cut changes the state of its Event. A changed process state changes the state
// of every Event that carries the process or that its subject takes part in. A changed account reaches the Events at
// the moment it is about. Their passages, notes and the Events they cause are listed like those of a rewritten Event:
// changing only a Cut's weights once left a scene linked to its Event, and the later Event it causes, unnamed.
import { z } from 'zod';
import { eventTextSignature } from './cut-shares.mjs';
import { declaredReadEvidence, readingTextEvidence, readSignatures } from './reading-evidence.mjs';
import { indexModel, readingCut } from './model-questions.mjs';
import { passageGrounding } from './narrative-grounding.mjs';
import { tellingPhasesNeedingReview } from './document-projection.mjs';

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

export const revisionCheckSchema = z.object({
  graphHash: hash, accessScopes: z.array(id).max(64).default([]),
  fromModelHash: hash.describe('The model before the revision, or before a run of revisions.'),
  toModelHash: hash.optional().describe('The revised model; by default the one the graph is bound to.'),
  limit: z.number().int().min(1).max(200).default(40).describe('How many of each kind to list.'),
}).strict();

const weightsOf = (cut) => JSON.stringify((cut?.answers ?? []).map((answer) => [answer.key, +Number(answer.weight).toFixed(6)]).sort());
// Meaning is revisioned with the shares. Answer order and provenance do not redefine an allocation.
const definitionOf = (cut) => JSON.stringify([cut.question ?? null, cut.unit ?? null,
  cut.conditioning ? [cut.conditioning.cut_id, cut.conditioning.answer_key] : null,
  (cut.answers ?? []).map((answer) => [answer.key, answer.meaning ?? null]).sort()]);
const drawHasDefinition = (draw) => ['question', 'unit', 'conditioning'].every((key) => Object.hasOwn(draw, key));
const causal = new Set(['causes', 'enables', 'prevents', 'constrains', 'realizes_forecast']);

// The parts of a process record that carry its value and the meaning of that value; labels and provenance do not.
const processState = (process) => JSON.stringify([process.initial_value ?? null, process.value_type ?? null, process.unit ?? null,
  process.update_mode ?? null, process.scale?.authored_judgment_question ?? null]);
// An account is its holder's: who holds it, what it says, about when, on what evidence and with what certainty.
const accountOf = (claim) => JSON.stringify([claim.subject, claim.value ?? null, claim.value_time ?? null, claim.holder ?? null, claim.evidence_type ?? null,
  claim.evidence_cutoff ?? null, claim.uncertainty ?? null, claim.mode ?? null]);
// Who a process is about: its declared subject and the referents bound to it.
const processSubjects = (model, processId) => [(model.processes ?? []).find((item) => item.id === processId)?.scale?.subject_referent_id,
  ...(model.meaning_model?.event_referent_bindings ?? []).filter((binding) => binding.target?.kind === 'process' && binding.target.process_id === processId)
    .map((binding) => binding.referent_id)].filter(Boolean);
const carries = (event, processId) => [...(event.process_ids ?? []), ...(event.observation_process_ids ?? [])].includes(processId);
const during = (event, t) => Number.isFinite(event.interval?.start) && event.interval.start <= t && (event.interval.end ?? event.interval.start) >= t;

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
  const relocated = [...eventsB.values()].filter((event) => eventsA.has(event.id)
    && ['region', 'substrate'].some((field) => (eventsA.get(event.id)[field] ?? null) !== (event[field] ?? null))).map((event) => event.id);
  const removedEvents = [...eventsA.keys()].filter((eventId) => !eventsB.has(eventId));
  const reweighted = [...cutsB.values()].filter((cut) => cutsA.has(cut.id) && weightsOf(cutsA.get(cut.id)) !== weightsOf(cut)).map((cut) => cut.id);
  const redefined = [...cutsB.values()].filter((cut) => cutsA.has(cut.id) && definitionOf(cutsA.get(cut.id)) !== definitionOf(cut)).map((cut) => cut.id);
  const withdrawn = [...cutsB.values()].filter((cut) => cut.withdrawn && cutsA.has(cut.id) && !cutsA.get(cut.id).withdrawn).map((cut) => cut.id);
  const removedCuts = [...cutsA.keys()].filter((cutId) => !cutsB.has(cutId));
  const moved = [...cutsB.values()].filter((cut) => cutsA.has(cut.id) && cutsA.get(cut.id).parent_event_id !== cut.parent_event_id).map((cut) => cut.id);
  const changedCuts = new Set([...reweighted, ...redefined, ...withdrawn, ...removedCuts, ...moved]);
  const changedEvents = new Set([...rewritten, ...retimed, ...relocated, ...removedEvents]);
  // What depended on it.
  const conditioned = [...cutsB.values()].filter((cut) => !cut.withdrawn && cut.conditioning?.cut_id && changedCuts.has(cut.conditioning.cut_id))
    .map((cut) => ({ cutId: cut.id, on: cut.conditioning.cut_id, why: withdrawn.includes(cut.conditioning.cut_id) || removedCuts.includes(cut.conditioning.cut_id) ? 'it is conditioned on a Cut that is gone: withdraw it with its parent or condition it on the new one'
      : redefined.includes(cut.conditioning.cut_id) || moved.includes(cut.conditioning.cut_id) ? 'the definition or Event of its conditioning Cut changed: check the answer it divides still means the same thing'
        : 'the answer it divides changed weight, so its joint shares changed: check it still holds' }));
  // A retained draw can match a restored Cut. Older draws without a complete definition cannot establish that match.
  const records = (view.nodes ?? []).filter((node) => node.node_type === 'direction_draw').map((node) => { try { const data = JSON.parse(node.text); return data?.cutId ? data : null; } catch { return null; } }).filter(Boolean);
  const draws = records.filter((draw) => changedCuts.has(draw.cutId) || moved.includes(draw.cutId))
    .filter((draw) => !draw.answers || !cutsB.has(draw.cutId) || cutsB.get(draw.cutId).withdrawn || weightsOf(cutsB.get(draw.cutId)) !== weightsOf({ answers: draw.answers }) || moved.includes(draw.cutId)
      || (redefined.includes(draw.cutId) && (!drawHasDefinition(draw) || definitionOf(cutsB.get(draw.cutId)) !== definitionOf(draw))))
    .map((draw) => ({ cutId: draw.cutId, realized: draw.realized ?? null, why: moved.includes(draw.cutId) && cutsB.has(draw.cutId) && draw.answers && weightsOf(cutsB.get(draw.cutId)) === weightsOf({ answers: draw.answers })
      ? 'its Cut moved to another Event: re-point the realizes_forecast relation that names it'
      : redefined.includes(draw.cutId) ? 'its Cut definition changed, and the saved draw does not establish the same meaning: keep the draw and review its interpretation against its recorded model; redraw only if you decide to, as a visible reroll'
        : 'it was drawn from weights that have changed: keep the draw, and mark it as drawn from a superseded state; redraw only if you decide to, as a visible reroll' }));
  const index = indexModel(after);
  // Events whose numbers changed although their text did not: through a Cut on them, through the declared state of a
  // process, or through an account of a process at their moment. A reading's Cut is a view of the model, not its state.
  const stateChanged = new Map();
  const restate = (eventId, reason) => {
    if (!eventsB.has(eventId) || index.readings?.has(eventId)) return;
    if (!stateChanged.has(eventId)) stateChanged.set(eventId, new Set());
    stateChanged.get(eventId).add(reason);
  };
  for (const cutId of changedCuts) {
    const cut = cutsB.get(cutId) ?? cutsA.get(cutId);
    if (readingCut(index, cut)) continue;
    for (const eventId of new Set([cutsA.get(cutId)?.parent_event_id, cutsB.get(cutId)?.parent_event_id].filter(Boolean))) restate(eventId, `cut:${cutId}`);
  }
  // The Events a process concerns: those that carry or observe it, and the dated Events its subject takes part in other
  // than the subject's whole life.
  const concerned = (processId) => {
    const ids = new Set([...eventsB.values()].filter((event) => carries(event, processId)).map((event) => event.id));
    for (const subject of new Set([...processSubjects(before, processId), ...processSubjects(after, processId)])) {
      const life = index.referents.get(subject)?.lifecycle_event_id;
      for (const eventId of index.eventsOf.get(subject) ?? []) if (eventId !== life && Number.isFinite(eventsB.get(eventId)?.interval?.start)) ids.add(eventId);
    }
    return [...ids].map((eventId) => eventsB.get(eventId)).filter(Boolean);
  };
  // A changed state holds wherever the process does.
  const processesA = new Map((before.processes ?? []).map((process) => [process.id, process]));
  const processStates = (after.processes ?? []).filter((process) => processesA.has(process.id) && processState(processesA.get(process.id)) !== processState(process)).map((process) => process.id);
  for (const processId of processStates) for (const event of concerned(processId)) restate(event.id, `process:${processId}`);
  // A changed account is about one moment, its value_time; without one, it concerns the Events that carry the process.
  // Both sides count: an account corrected to another process or moment leaves the Events it was about as well as
  // reaching the new ones.
  const claimsA = new Map((before.initial_claims ?? []).map((claim) => [claim.id, claim]));
  const claimsB = new Map((after.initial_claims ?? []).map((claim) => [claim.id, claim]));
  const accounts = [];
  const accountText = new Map();
  for (const claimId of new Set([...claimsA.keys(), ...claimsB.keys()])) {
    const [old, now] = [claimsA.get(claimId), claimsB.get(claimId)];
    if (old && now && accountOf(old) === accountOf(now)) continue;
    const claim = now ?? old;
    const moved = Boolean(old && now && old.subject !== now.subject);
    accounts.push({ claimId, processId: claim.subject, ...(moved ? { formerProcessId: old.subject } : {}), holder: claim.holder ?? null, at: claim.value_time ?? null,
      change: !old ? 'added' : !now ? 'removed' : 'changed' });
    for (const side of [old, now].filter(Boolean)) {
      const key = `claim:${JSON.stringify([claimId, side.subject, side.value_time ?? null])}`;
      accountText.set(key, `an account of process ${side.subject}${Number.isFinite(side.value_time) ? ` at ${side.value_time}` : ''}, held by ${side.holder ?? 'an unnamed holder'}, ${!old ? 'was added' : !now ? 'was removed' : moved && side === old ? `now concerns process ${now.subject}` : 'was changed'}`);
      for (const event of concerned(side.subject)) if (Number.isFinite(side.value_time) ? during(event, side.value_time) : carries(event, side.subject)) restate(event.id, key);
    }
  }
  const touched = new Set([...changedEvents, ...stateChanged.keys()]);
  const readings = [];
  for (const cut of cutsB.values()) {
    if (cut.withdrawn) continue;
    const evidence = readingTextEvidence(cut, index);
    const textStale = evidence.status === 'needs_review' || evidence.status === 'unresolved';
    // Recorded reads are compared whatever revisions are checked, so a change stays visible until it is answered.
    const changedReads = declaredReadEvidence(cut, index).parts.filter((part) => part.status !== 'unchanged')
      .map(({ kind, eventId, cutoff, depth, compared, status }) => ({ kind, eventId, ...(kind === 'life' ? { cutoff, depth } : {}), compared, status }));
    if (!textStale && !changedReads.length) continue;
    readings.push({ cutId: cut.id, eventId: evidence.eventId ?? null,
      changedInRevision: rewritten.includes(evidence.eventId) || changedReads.some((part) => part.kind === 'event' && changedEvents.has(part.eventId)),
      ...(textStale && evidence.eventId ? { compared: `the text of Event ${evidence.eventId}` } : {}),
      ...(changedReads.length ? { changedReads } : {}),
      why: textStale ? evidence.reason : 'a read this judgment recorded has changed since it was made: check that it still holds, then record the new reads or revise it' });
  }
  // An assessment about a changed Event may no longer fit it, even when its own Event text is unchanged or was never
  // signed. An about link records reference, not a declared dependency, so these are listed for review, as notes are,
  // until a recorded read covers the current text of each changed Event the assessment is about.
  const aboutChanged = new Map();
  for (const relation of b.event_relations ?? []) {
    const about = relation.kind === 'about' || (relation.kind === 'other' && /^about\b/iu.test(String(relation.description ?? '')));
    if (!about || !changedEvents.has(relation.target_event_id)) continue;
    if (!aboutChanged.has(relation.source_event_id)) aboutChanged.set(relation.source_event_id, new Set());
    aboutChanged.get(relation.source_event_id).add(relation.target_event_id);
  }
  const listedReadings = new Set(readings.map((item) => item.cutId));
  const assessments = [];
  for (const cut of cutsB.values()) {
    if (cut.withdrawn || listedReadings.has(cut.id) || !aboutChanged.has(cut.parent_event_id)) continue;
    const about = [...aboutChanged.get(cut.parent_event_id)].sort();
    const text = readingTextEvidence(cut, index);
    const declared = declaredReadEvidence(cut, index);
    const covered = new Set(declared.parts.filter((part) => part.kind === 'event' && part.status === 'unchanged').map((part) => part.eventId));
    if (text.status === 'unchanged' && text.eventId) covered.add(text.eventId);
    if (about.every((eventId) => covered.has(eventId))) continue;
    assessments.push({ cutId: cut.id, eventId: cut.parent_event_id, about, textBasis: text.status,
      compared: [...(text.eventId ? [`the text of Event ${text.eventId}`] : []), ...declared.parts.map((part) => part.compared)],
      ...readSignatures(cut, index, about),
      why: 'its Event is about an Event that changed: check that the assessment and its weights still fit, then record signWith (and lifeRead if the judgment read the life so far) or revise them' });
  }
  const reasonText = (reason) => {
    if (reason.startsWith('cut:')) return `Cut ${reason.slice(4)} on it changed`;
    if (reason.startsWith('process:')) return `the declared state of process ${reason.slice(8)} changed`;
    return accountText.get(reason);
  };
  // What changed an Event, as listed: an account is named by its claim alone.
  const reasonLabel = (reason) => (reason.startsWith('claim:') ? `claim:${JSON.parse(reason.slice(6))[0]}` : reason);
  // An account changed is not a state changed: say which it was.
  const numbersChanged = (eventIds) => {
    const reasons = eventIds.flatMap((eventId) => [...(stateChanged.get(eventId) ?? [])]);
    return `an Event ${reasons.every((reason) => reason.startsWith('claim:')) ? 'about which an account changed' : 'whose modeled state changed'} (${[...new Set(reasons)].map(reasonText).join('; ')})`;
  };
  const later = (b.event_relations ?? []).filter((relation) => causal.has(relation.kind) && touched.has(relation.source_event_id) && eventsB.has(relation.target_event_id))
    .map((relation) => ({ eventId: relation.target_event_id, from: relation.source_event_id, relation: relation.kind,
      why: changedEvents.has(relation.source_event_id) ? 'it follows from an Event that changed: check its description, interval and placement still hold'
        : `it follows from ${numbersChanged([relation.source_event_id])}: check its description, interval and placement still hold` }));
  const anchored = new Map(); const depicted = new Map();
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
    const hit = (edge.target.anchor_kind === 'event' && touched.has(edge.target.anchor_id)) || (edge.target.anchor_kind === 'normalized_cut' && changedAnchoredCuts.has(edge.target.anchor_id));
    if (hit) {
      addAnchor(anchored, edge.source.node_id, edge.target.anchor_id);
      if (renders) addAnchor(depicted, edge.source.node_id, edge.target.anchor_id);
    }
  }
  const nodes = new Map((view.nodes ?? []).map((node) => [node.id, node]));
  // A record changed directly when its own text, time, place or weights changed; otherwise only the state of an Event did.
  const direct = (recordId) => changedEvents.has(recordId) || changedAnchoredCuts.has(recordId);
  const passages = [...depicted].filter(([nodeId]) => nodes.get(nodeId)?.render === 'include').map(([nodeId, records]) => ({ nodeId, records: [...records],
    why: [...records].some(direct) ? 'it declares a renders dependency on a record that changed: regenerate it or mark it'
      : `it renders ${numbersChanged([...records])}: check the depiction still fits, then regenerate it or say why it stands` }));
  // An about/support/provenance link is not a declaration that this passage depicts its target.
  // A document's Markdown heading names the work; prose on that same root still needs its own grounding.
  const grounding = passageGrounding(view);
  const unlinked = grounding.filter((item) => !item.eventIds.length && !item.noLink).map((item) => item.nodeId);
  const intentionallyUnlinked = grounding.filter((item) => !item.eventIds.length && item.noLink).map(({ nodeId, noLink }) => ({ nodeId, ...noLink }));
  const notes = [...anchored].filter(([nodeId]) => nodes.get(nodeId) && nodes.get(nodeId).render !== 'include' && String(nodes.get(nodeId).node_type ?? '').startsWith('understanding.'))
    .map(([nodeId, records]) => ({ nodeId, records: [...records], why: [...records].some(direct) ? 'a note about a record that changed: it may describe the old account'
      : `a note about ${numbersChanged([...records])}: it may describe the old state` }));
  // Telling phases depend on the text, not on the model revisions compared, so they are checked in the graph itself.
  const scopes = [...new Set(input.accessScopes)].sort();
  const tellingState = typeof service.renderNarrativeGraph === 'function'
    ? await tellingPhasesNeedingReview(service, { graphHash: input.graphHash, view, accessScopes: scopes }) : { phases: [], notChecked: [] };
  const telling = tellingState.phases.map((phase) => ({ ...phase, why: phase.status === 'unresolved'
    ? 'its span no longer resolves in the rendered document: repair the span or retire the phase'
    : 'the passages or reading order it was read against changed: re-read the phase, then record a superseding assessment or why it stands' }));
  const limit = (list) => list.slice(0, input.limit);
  const toCheck = conditioned.length + draws.length + readings.length + assessments.length + later.length + passages.length + notes.length + telling.length;
  return {
    schema: 'meaning-model-revision-check/v1', fromModelHash: input.fromModelHash, toModelHash: toHash, graphMutation: false,
    changed: { rewritten: limit(rewritten), retimed: limit(retimed), relocated: limit(relocated), removedEvents: limit(removedEvents), reweighted: limit(reweighted), redefined: limit(redefined), withdrawn: limit(withdrawn), removedCuts: limit(removedCuts), moved: limit(moved),
      processStates: limit(processStates), accounts: limit(accounts), stateChanged: limit([...stateChanged].map(([eventId, by]) => ({ eventId, by: [...new Set([...by].map(reasonLabel))] }))) },
    toCheck, conditioned: limit(conditioned), draws: limit(draws), readings: limit(readings), assessments: limit(assessments), later: limit(later), passages: limit(passages), notes: limit(notes), telling: limit(telling),
    ...(tellingState.notChecked.length ? { tellingNotChecked: tellingState.notChecked } : {}),
    ...(intentionallyUnlinked.length ? { intentionallyUnlinked: { count: intentionallyUnlinked.length, passages: limit(intentionallyUnlinked) } } : {}),
    ...(unlinked.length ? { unlinkedPassages: { count: unlinked.length, nodeIds: limit(unlinked), why: 'These passages have no declared Event/renders link or current per-passage no-link reason. Use life_narrative_grounding_propose, then confirm or correct selections with life_narrative_grounding_apply. Cut links remain useful dependencies but do not replace the passage Event declaration.' } } : {}),
    notChecked: 'Concept definition or withdrawal changes, abstract-Cut changes and relation changes are not compared; inspect their linked notes and other dependents manually. Whether the prose agrees with its declared dependencies, whether those links cover everything it depicts, and whether the revision gives anyone knowledge they did not then have. Check meaning and disclosures by hand. Passages are followed through the Events they render: one that renders only an enclosing or enclosed Event of a changed one is not listed, and process changes reach only Events that carry the process or that its subject takes part in; an account reaches the Events at the moment it is about, not later Events in which its holder acts on it. Later Events are followed one relation at a time; check again after revising them. Graph dependencies are limited to the supplied accessScopes.',
    nextStep: `${toCheck ? 'First deepen the model where the revision shows a gap. Then bring each dependent into line with the revision, or say why it stands: check assessments about changed Events and record their returned signWith once rechecked, re-condition or withdraw children, keep draws as drawn, review affected notes, and regenerate or mark the passages. Re-read stale readings (life_lens_reread) and renew telling phases together once the text settles, not after every change.' : 'No affected declared dependencies were found in the checked records.'}${unlinked.length ? ` ${unlinked.length} passage${unlinked.length === 1 ? ' needs' : 's need'} an Event/renders declaration or a current per-passage no-link reason.` : ''}`,
  };
}

export function registerRevisionCheckTools(server, service, { toolResult }) {
  server.registerTool('life_revision_check', {
    description: 'After a revision, inspect recorded dependencies that need review. Given the model before and after, it names detected changes (Events rewritten, retimed, relocated through region/substrate edits or removed; Cuts reweighted, withdrawn, removed or moved; processes whose declared state changed (initial value, bounds, unit, update mode or rubric); changed accounts of a process value (claims added, removed or changed, with holder and time), kept apart from its state; and Events whose numbers changed without their text: through a Cut on them, through a changed process state wherever they carry the process or its subject takes part in them, or through a changed account at their moment), dependent Cuts and draws, outstanding stale text readings, Cuts whose Event is about a changed Event (listed for review until a recorded read covers the changed text, since an about link is not a declared dependency, with signWith and an optional lifeRead to record after a recheck), directly related later Events, passages with grounding/renders links, and notes anchored to changed records, each also for the Events whose modeled state changed. It also lists telling phases (document processes) whose reviewed passages or reading order changed, or whose span no longer resolves, on every check until they are renewed, since they depend on the text rather than on the model revisions compared. Text readings include earlier unresolved changes: changedInRevision distinguishes this revision from an older backlog. Passages without a declared renders link are unchecked. Placement changes flag dependencies without claiming that a text-based estimate read changed text. A Cut may record what it read in provenance: read:event:<eventId>=<signature> for one Event, and read:life:<lifecycleEventId>@<cutoff or *>/<depth>=<signature> for the life account of a subject to a cutoff at a containment depth; each is compared with the current records whatever revisions are checked, and compared names the text each signature covers. An event-text signature covers the Event a reading reads: the Event it is about for readings under an understanding root, otherwise its own Event. Signatures are the first 16 hex digits of SHA-256 over JSON: [boundary, description] for an Event, and the id-sorted rows [id, boundary, description, interval] of the lifecycle and its contained Events for a life account; a life account covers what the lifecycle contains, not Events the subject only takes part in, so name those Events with read:event. Recording reads is optional; a Cut without them is untracked. This does not verify prose meaning, dependency completeness, or character knowledge.',
    inputSchema: revisionCheckSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await checkRevision(service, input)));
}
