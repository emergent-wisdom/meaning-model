// The director. The Book of Conditions became good through a loop: a human told the writing model what makes a
// good story, each principle forced the model back into the world model to make it deeper, and the prose was
// rebuilt from the deeper model. The human never read the book. This module is that human's side of the loop,
// written down so any agent can run it. Apply its challenges to this work, distinguish model gaps from prose
// problems, and record the repairs and subsequent reading rather than making every repair change the world.
import { createHash } from 'node:crypto';
import { resolveAppendHead } from './graph-head.mjs';
import * as z from 'zod/v4';
import { prepareAuthorRecord } from './storytelling-authoring.mjs';
import { readOpenQuestions } from './model-questions.mjs';

export const DIRECTION_SCHEMA = 'meaning-model-story-direction/v1';
const id = z.string().trim().min(1).max(256);
const text = (min = 1, max = 16_000) => z.string().trim().min(min).max(max);

// Challenges drawn from the Book's own loop, not universal laws of fiction. Applicability and evidence belong
// to the work under review; a reasoned not-this-story finding stays in its audit record.
export const directorPrinciples = Object.freeze([
  { id: 'world.author', stage: 'world', source: 'director', principle: 'The story comes out of the author\'s modeled life: what they are figuring out by writing it is the world\'s central question, and you can point to the life records it comes from.' },
  { id: 'world.buttons', stage: 'world', source: 'director', principle: 'The premise presses a button in its reader, a fear, longing, shame or hope, and the reader could learn something about their own life from it.' },
  { id: 'world.necessity', stage: 'world', source: 'U01', principle: 'Each principal carries a function the causality needs; no one exists only to supply the plot, and no one absorbs everyone else\'s roles.' },
  { id: 'world.plausibility', stage: 'world', source: 'U02', canBeInapplicable: true, principle: 'Every departure from the ordinary, historical or established world is plausible at the model\'s resolution; when one is not, shrink the departure rather than inflating the world to rescue it.' },
  { id: 'world.documented', stage: 'world', source: 'director', canBeInapplicable: true, principle: 'Where the era is real, the world holds to what the sources document up to a stated cutoff, recorded as reports with their sources, and the story invents only after it; what could not be found stays open rather than guessed. Living people and real organizations do not take part as characters: invented ones take their place, and the real world stays in the background.' },
  { id: 'world.shock', stage: 'world', source: 'U03', principle: 'The central shock changes the principals\' wants and readings in different directions rather than confirming what they already believed. Consider the shock that would do this most: sometimes a success, a gift or a recognition rather than another loss.' },
  { id: 'world.failure', stage: 'world', source: 'U04', principle: 'The turn or failure comes from processes the model holds and quantities that can be traced, not from something breaking conveniently at the dramatic moment.' },
  { id: 'world.agency', stage: 'world', source: 'U05', principle: 'No death, illness or accident does the plot\'s work; the outcome comes from the characters\' choices.' },
  { id: 'world.ending', stage: 'world', source: 'U06', principle: 'The ending claims only what the world earned, and what survives it means something because of how it was made.' },
  { id: 'world.macro', stage: 'world', source: 'director', principle: 'The long developments behind the world are modeled, over decades or centuries (a war a hundred years back, an institution, a technology, a family line), and each principal\'s childhood is modeled where it explains what they do.' },
  { id: 'world.lives', stage: 'world', source: 'director', principle: 'Every principal is an authentic person in the model: a whole life, the deepest wants underneath and the learned wants that serve them, the proxy that displaces a deep aim, shocks and adaptations that change many functions, conflicting wants that bargain.' },
  { id: 'world.mechanisms', stage: 'world', source: 'director', principle: 'The Things this story\'s causality runs through, whatever they are here (a machine, an institution, a house, a body, a document, a market), are modeled as they work: their parts, capacities, limits, failure modes and quantities, and how these constrain what people can do. None of those is only a name.' },
  { id: 'world.aspects', stage: 'world', source: 'director', principle: 'Every element of what makes a story interesting (the catalog: people, events, the world, meaning) has been found where it lives in this story and investigated by modeling; the list is current.' },
  { id: 'world.flaws', stage: 'world', source: 'director', principle: 'Each principal\'s flaw is modeled as a process over their life: the event that taught it, the situations in which it takes over, where the same trait is a strength and where it does harm, what it costs in the story\'s choices, and whether they see it.' },
  { id: 'world.background', stage: 'world', source: 'director', principle: 'The world is modeled far beyond what the story shows: the background processes of reality (the economy and prices, seasons and weather, bodies and illness, institutions and their routines, other families and neighbors, the technology of the day, the long histories) run in the model whether or not a scene ever touches them. The story is a small window onto them, and what it shows is real because of what it does not show.' },
  { id: 'world.jumps', stage: 'world', source: 'director', principle: 'The route runs through the model\'s largest jumps, and each part tests something different; if the story is elsewhere, the route says why.' },
  { id: 'draft.character-test', stage: 'draft', source: 'PERSON-MODELS', principle: 'Ask what this scene contributes in its context. Differences in understanding, consequential reliance, anticipation or adaptation, slow change, and conflicting wants can be useful questions. They are not a mandatory list: ordinary continuity, atmosphere, pleasure, breathing room and delayed payoff can justify a scene without a turn or character test.' },
  { id: 'draft.residue', stage: 'draft', source: 'U11', principle: 'Adaptation shows through objects that return with a changed use, not through explanation or an added catastrophe.' },
  { id: 'draft.fallibility', stage: 'draft', source: 'U12', principle: 'The principals are fallible in ways the model causes, and secondary people have lives with consequences beyond their assigned jobs.' },
  { id: 'draft.speech', stage: 'draft', source: 'U12', principle: 'Speech fits the person, situation and form. Handling things, interruption, hesitation and the language of work may support it; deliberate formality or thematic speech can also be authentic. Do not force every speaker into the same fragmented manner.' },
  { id: 'draft.joy', stage: 'draft', source: 'U13', principle: 'Competence, discovery and pleasure in the work are felt, and they change what people believe in the model: a positive shock is perceptible, not reported.' },
  { id: 'draft.documented', stage: 'draft', source: 'U14', canBeInapplicable: true, principle: 'Where real people or real knowledge appear, their documented positions are developed inside the story, not quoted or given modern terms; living people and real organizations do not take part, the invented ones the world put in their place do.' },
  { id: 'draft.voice', stage: 'draft', source: 'U15', principle: 'Each voice is credible through the person\'s modeled life and present situation. The narrator does not flatten meaningful differences, but shared language, resemblance and changing register can be authentic; do not force every pair of voices to differ.' },
  { id: 'draft.senses', stage: 'draft', source: 'U15', principle: 'Sensory detail comes from the Things taking part in each Event and their changing state; atmosphere never becomes a hidden cause.' },
  { id: 'draft.fresh-read', stage: 'draft', source: 'U16', principle: 'Read as someone new to the whole manuscript. Distinguish an unexplained cause in the model from an existing cause poorly conveyed in prose, and from deliberate uncertainty. Repair the model when its explanation is missing; a wording or disclosure problem may need only a prose revision.' },
  { id: 'draft.time', stage: 'draft', source: 'director', principle: 'Each person in each scene matches the model\'s state at that moment, and everything that changes between scenes has a modeled cause.' },
  { id: 'draft.richer', stage: 'draft', source: 'director', principle: 'Ask where a scene, Event, person or Thing needs deeper understanding, and investigate what remains only a name when it matters to the work. Depth does not require longer prose or maximum detail; restraint and a justified decision to keep the text are valid.' },
  { id: 'draft.ending', stage: 'draft', source: 'director', principle: 'Every principal pays for the ending.' },
].map((principle) => ({ ...principle, canBeInapplicable: true })));
const principlesFor = (stage) => directorPrinciples.filter((item) => item.stage === stage);

export const directionSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u), requestId: id, storyRootId: id, exactRevision: z.boolean().default(false).describe('Write against graphHash exactly, creating a branch if it is not the newest revision. By default an add-only record goes to the newest head.'),
  accessScopes: z.array(id).min(1).max(64),
  stage: z.enum(['world', 'draft']).describe('world before the first scene, after the route; draft after a completed part and before release.'),
  directorId: id.describe('Who directs: a fresh reviewer who has not written the work where one is available, otherwise the writing agent itself, which then says so in independent.'),
  independent: z.boolean().describe('True only when the director did not write the work.'),
  nodeId: id.optional().describe('Supply with findings to record the direction.'),
  findings: z.array(z.object({
    principleId: id,
    verdict: z.enum(['holds', 'fails', 'not-this-story']),
    evidence: text(10, 4_000).describe('Where it holds or fails in this work, citing text and model records as relevant; for not-this-story, explain its inapplicability to this form, purpose or context.'),
    modelChange: text(10, 4_000).nullable().default(null).describe('For a model defect: what must change in the model. Null is valid for a prose-only repair.'),
    proseChange: text(10, 4_000).nullable().default(null).describe('For a draft defect: the needed prose repair. A failure requires modelChange, proseChange, or both; a prose repair needs an answers record and a fresh passing read of changed prose.'),
  }).strict()).max(40).optional().describe('Omit to receive the direction task; supply to record it.'),
  ownFindings: z.array(z.object({
    name: text(2, 200).describe('What this work needs that no principle names.'),
    verdict: z.enum(['holds', 'fails']),
    evidence: text(10, 4_000),
    modelChange: text(10, 4_000).nullable().default(null),
    proseChange: text(10, 4_000).nullable().default(null),
  }).strict()).max(20).default([]).describe('The principles are a start, not a boundary: at least one finding of your own about what this work needs that no principle names.'),
  summary: text(10, 4_000).optional(),
}).strict();

export const directionInstructions = `Read the world before the first scene and the draft before release, as a fresh reviewer where you can. The principles are a start, not a boundary: judge their applicability to this work's form, purpose and context, and explain not-this-story when a challenge does not fit. Add what this work needs that none names. Encourage depth where understanding is missing, including background processes beyond the prose, without a quota for detail, dramatic turns or repairs. Shared voices, ordinary continuity, atmosphere and breathing room may be meaningful. Distinguish a model defect from a prose defect; record modelChange, proseChange, or both for a failure. A justified keep decision is valid. Record how failures were answered and re-read revised prose; neither a changed hash nor a repair note proves literary success.`;

function readDirections(view, storyRootId) {
  const answered = new Set((view.edges ?? []).filter((edge) => edge.relation === 'answers' && edge.target?.kind === 'node').map((edge) => edge.target.node_id));
  return (view.nodes ?? []).filter((node) => node.node_type === 'storytelling.direction' && node.subject === storyRootId).map((node) => {
    let data = null; try { data = JSON.parse(node.text).data; } catch { data = null; }
    return data?.schema === DIRECTION_SCHEMA ? { node, data, answered: answered.has(node.id) } : null;
  }).filter(Boolean).sort((a, b) => (a.node.value_time ?? 0) - (b.node.value_time ?? 0));
}

// The prose a draft direction read: each rendered unit of the story and its content. Changing the prose changes it;
// notes, which never render, and a rebind to a revised model do not.
export async function proseSignature(service, graphHash, storyRootId, accessScopes) {
  const rendered = await service.renderNarrativeGraph({ graphHash, rootIds: [storyRootId], accessScopes: [...new Set(accessScopes)].sort() });
  const units = (rendered?.units ?? []).map((unit) => [unit.node_id, unit.content_hash ?? createHash('sha256').update(String(unit.text ?? '')).digest('hex')]);
  return createHash('sha256').update(JSON.stringify(units)).digest('hex');
}

// Legacy failures require a model revision. An explicit prose-only repair instead requires changed prose and
// a later passing draft direction, as well as the existing answers record. Release verifies that read is current.
export function directionState(view, storyRootId, boundModelHash) {
  const all = readDirections(view, storyRootId);
  const latest = (stage) => all.filter((item) => item.data.stage === stage).at(-1) ?? null;
  const draft = latest('draft');
  const unanswered = all.flatMap((item, index) => {
    const failures = item.data.findings.filter((finding) => finding.verdict === 'fails');
    if (!failures.length) return [];
    const modelChangeRequired = failures.some((finding) => finding.modelChange || !finding.proseChange);
    const proseChangeRequired = failures.some((finding) => finding.proseChange);
    const proseReviewed = !!(draft && all.indexOf(draft) > index && item.data.proseSignature && draft.data.proseSignature
      && draft.data.proseSignature !== item.data.proseSignature && !draft.data.findings.some((finding) => finding.verdict === 'fails'));
    const modelUnchanged = item.data.modelHash === boundModelHash;
    return !item.answered || (modelChangeRequired && modelUnchanged) || (proseChangeRequired && !proseReviewed)
      ? [{ nodeId: item.node.id, stage: item.data.stage, failing: failures.map((finding) => finding.principleId),
        modelUnchanged, modelChangeRequired, proseChangeRequired, proseReviewed, answered: item.answered }] : [];
  });
  return { world: latest('world'), draft, unanswered };
}

export async function direct(service, raw) {
  const input = directionSchema.parse(raw);
  const head = await resolveAppendHead(service, input.graphHash, input.requestId, input.exactRevision);
  input.graphHash = head.graphHash;
  const accessScopes = [...new Set(input.accessScopes)].sort();
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes });
  const modelHash = view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
  const principles = principlesFor(input.stage);
  if (!input.findings) {
    const open = modelHash ? await readOpenQuestions(service, { modelHash, graphHash: input.graphHash, accessScopes, limit: 16 }).catch(() => null) : null;
    const rendered = input.stage === 'draft' ? await service.renderNarrativeGraph?.({ graphHash: input.graphHash, rootIds: [input.storyRootId], accessScopes }).catch(() => null) : null;
    return { schema: 'meaning-model-story-direction-task/v1', stage: input.stage, directorId: input.directorId, independent: input.independent, principles,
      model: open && { questions: open.questions, jumps: open.jumps, depth: open.depth }, text: rendered?.text ?? null,
      instructions: `${directionInstructions} For each principle, give holds, fails or not-this-story with contextual evidence. For a failure, specify the model and/or prose repair. Then call life_story_direct again with findings to record the direction.`,
      worked: 'The Book of Conditions records its own loop in examples/book-of-conditions/UNDERSTANDING-NOTES.md: each note names its target Events, why, what changed in the model first and what changed in the prose.' };
  }
  const expected = new Set(principles.map((item) => item.id));
  const given = input.findings.map((item) => item.principleId);
  if (new Set(given).size !== given.length || given.some((principleId) => !expected.has(principleId)) || [...expected].some((principleId) => !given.includes(principleId))) {
    throw new Error(`A ${input.stage} direction gives exactly one finding for each of its principles: ${[...expected].join(', ')}.`);
  }
  if (!input.ownFindings.length) throw new Error('The principles are a start, not a boundary: add at least one finding of your own (ownFindings) about what this work needs that no principle names.');
  const findings = [...input.findings, ...input.ownFindings.map(({ name, ...finding }) => ({ principleId: `own:${name}`, ...finding }))];
  const unplanned = findings.filter((item) => item.verdict === 'fails' && !item.modelChange && !item.proseChange);
  if (unplanned.length) throw new Error(`Specify modelChange, proseChange, or both for each failure: ${unplanned.map((item) => item.principleId).join(', ')}.`);
  if (input.stage !== 'draft' && findings.some((item) => item.proseChange)) throw new Error('A prose repair belongs to a draft direction; the world direction reviews the model before prose.');
  if (!input.nodeId || !input.summary) throw new Error('Recording a direction needs nodeId and summary.');
  const prose = input.stage === 'draft' ? { proseSignature: await proseSignature(service, input.graphHash, input.storyRootId, accessScopes), proseScopes: accessScopes } : {};
  const record = await prepareAuthorRecord(service, { graphHash: input.graphHash, requestId: input.requestId, nodeId: input.nodeId, storyRootId: input.storyRootId, exactRevision: true,
    authorId: input.directorId, accessScopes, kind: 'direction', text: input.summary,
    data: { schema: DIRECTION_SCHEMA, stage: input.stage, directorId: input.directorId, independent: input.independent, modelHash, ...prose,
      findings } });
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: record.narrativeBatch });
  const failing = findings.filter((item) => item.verdict === 'fails');
  return { ...stored, ...record.receipt, ...(head.advancedFrom ? { advancedFrom: head.advancedFrom } : {}), schema: 'meaning-model-story-direction-record/v1', directionNodeId: input.nodeId, stage: input.stage, failing: failing.map((item) => item.principleId),
    nextStep: failing.length
      ? `Repair each failure where it belongs: modelChange requires a model revision and graph rebind; proseChange requires revised prose and a fresh passing draft direction. Record what changed with answers pointing to ${input.nodeId}. A prose-only repair does not require a world change. Release still checks outstanding failures and the exact reviewed prose.`
      : 'No unresolved failure was found in this direction. Keep the work if that is the supported judgment; label self-review honestly and seek a fresh reader at a substantial milestone where available.' };
}
