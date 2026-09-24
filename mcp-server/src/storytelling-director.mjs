// The director. The Book of Conditions became good through a loop: a human told the writing model what makes a
// good story, each principle forced the model back into the world model to make it deeper, and the prose was
// rebuilt from the deeper model. The human never read the book. This module is that human's side of the loop,
// written down so any agent can run it: principles for the world and for the draft, each failure answered in the
// model first, and scene preparation and release blocked until the model has actually changed in answer.
import * as z from 'zod/v4';
import { prepareAuthorRecord } from './storytelling-authoring.mjs';
import { readOpenQuestions } from './model-questions.mjs';

export const DIRECTION_SCHEMA = 'meaning-model-story-direction/v1';
const id = z.string().trim().min(1).max(256);
const text = (min = 1, max = 16_000) => z.string().trim().min(min).max(max);

// Each principle is a challenge, general enough for any story; what it asks for is decided by this story. Its
// source is the Book's own record of the loop (UNDERSTANDING-NOTES.md and PERSON-MODELS.md) or the principles its
// human director gave. What is interesting differs between stories, but that decides what the story shows, never
// how much the world is modeled: the point is always to go deeper and model more, including a great deal that never
// appears in the story, as the background processes of reality. Only a principle that cannot apply (no real people,
// no departure from history) may be marked not-this-story, with the reason.
export const directorPrinciples = Object.freeze([
  { id: 'world.author', stage: 'world', source: 'director', principle: 'The story comes out of the author\'s modeled life: what they are figuring out by writing it is the world\'s central question, and you can point to the life records it comes from.' },
  { id: 'world.buttons', stage: 'world', source: 'director', principle: 'The premise presses a button in its reader, a fear, longing, shame or hope, and the reader could learn something about their own life from it.' },
  { id: 'world.necessity', stage: 'world', source: 'U01', principle: 'Each principal carries a function the causality needs; no one exists only to supply the plot, and no one absorbs everyone else\'s roles.' },
  { id: 'world.plausibility', stage: 'world', source: 'U02', canBeInapplicable: true, principle: 'Every departure from the ordinary, historical or established world is plausible at the model\'s resolution; when one is not, shrink the departure rather than inflating the world to rescue it.' },
  { id: 'world.shock', stage: 'world', source: 'U03', principle: 'The central shock changes the principals\' wants and readings in different directions rather than confirming what they already believed. Consider the shock that would do this most: sometimes a success, a gift or a recognition rather than another loss.' },
  { id: 'world.failure', stage: 'world', source: 'U04', principle: 'The turn or failure comes from processes the model holds and quantities that can be traced, not from something breaking conveniently at the dramatic moment.' },
  { id: 'world.agency', stage: 'world', source: 'U05', principle: 'No death, illness or accident does the plot\'s work; the outcome comes from the characters\' choices.' },
  { id: 'world.ending', stage: 'world', source: 'U06', principle: 'The ending claims only what the world earned, and what survives it means something because of how it was made.' },
  { id: 'world.macro', stage: 'world', source: 'director', principle: 'The long developments behind the world are modeled, over decades or centuries (a war a hundred years back, an institution, a technology, a family line), and each principal\'s childhood is modeled where it explains what they do.' },
  { id: 'world.lives', stage: 'world', source: 'director', principle: 'Every principal is an authentic person in the model: a whole life, the deepest wants underneath and the learned wants that serve them, the proxy that displaces a deep aim, shocks and adaptations that change many functions, conflicting wants that bargain.' },
  { id: 'world.mechanisms', stage: 'world', source: 'director', principle: 'The Things this story\'s causality runs through, whatever they are here (a machine, an institution, a house, a body, a document, a market), are modeled as they work: their parts, capacities, limits, failure modes and quantities, and how these constrain what people can do. None of those is only a name.' },
  { id: 'world.aspects', stage: 'world', source: 'director', principle: 'Every aspect of the story that could be understood better has been listed (its choices, author and style, voices, technology, period, places, institutions, relationships, money, bodies, beliefs) and investigated by modeling; the list is current.' },
  { id: 'world.background', stage: 'world', source: 'director', principle: 'The world is modeled far beyond what the story shows: the background processes of reality (the economy and prices, seasons and weather, bodies and illness, institutions and their routines, other families and neighbors, the technology of the day, the long histories) run in the model whether or not a scene ever touches them. The story is a small window onto them, and what it shows is real because of what it does not show.' },
  { id: 'world.jumps', stage: 'world', source: 'director', principle: 'The route runs through the model\'s largest jumps, and each part tests something different; if the story is elsewhere, the route says why.' },
  { id: 'draft.character-test', stage: 'draft', source: 'PERSON-MODELS', principle: 'Every scene does at least one of these: exposes a difference between kinds of intelligence; makes one person\'s reliance on another consequential; shows the same Event producing different anticipation, appraisal or adaptation; changes a slow life process or reveals that an apparent change did not consolidate; forces a choice between a deep aim and the proxy that once served it. A scene that does none belongs in the world, not the book.' },
  { id: 'draft.residue', stage: 'draft', source: 'U11', principle: 'Adaptation shows through objects that return with a changed use, not through explanation or an added catastrophe.' },
  { id: 'draft.fallibility', stage: 'draft', source: 'U12', principle: 'The principals are fallible in ways the model causes, and secondary people have lives with consequences beyond their assigned jobs.' },
  { id: 'draft.speech', stage: 'draft', source: 'U12', principle: 'No one delivers balanced, thesis-bearing speech; people handle things, interrupt, hesitate and speak the language of their work.' },
  { id: 'draft.joy', stage: 'draft', source: 'U13', principle: 'Competence, discovery and pleasure in the work are felt, and they change what people believe in the model: a positive shock is perceptible, not reported.' },
  { id: 'draft.documented', stage: 'draft', source: 'U14', canBeInapplicable: true, principle: 'Where real people or real knowledge appear, their documented positions are developed inside the story, not quoted or given modern terms.' },
  { id: 'draft.voice', stage: 'draft', source: 'U15', principle: 'Each voice is derived from the person\'s modeled life and differs from the others; the narrator does not flatten them.' },
  { id: 'draft.senses', stage: 'draft', source: 'U15', principle: 'Sensory detail comes from the Things taking part in each Event and their changing state; atmosphere never becomes a hidden cause.' },
  { id: 'draft.fresh-read', stage: 'draft', source: 'U16', principle: 'Read as someone new to the whole manuscript: every causal gap a fresh reader would stumble on is closed in the model first, then in the prose.' },
  { id: 'draft.time', stage: 'draft', source: 'director', principle: 'Each person in each scene matches the model\'s state at that moment, and everything that changes between scenes has a modeled cause.' },
  { id: 'draft.richer', stage: 'draft', source: 'director', principle: 'Nothing is thinner than it could be: each scene, Event, person and Thing has been asked what could be richer, and what is still a name has been investigated in the model.' },
  { id: 'draft.ending', stage: 'draft', source: 'director', principle: 'Every principal pays for the ending.' },
]);
const principlesFor = (stage) => directorPrinciples.filter((item) => item.stage === stage);

export const directionSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u), requestId: id, storyRootId: id,
  accessScopes: z.array(id).min(1).max(64),
  stage: z.enum(['world', 'draft']).describe('world before the first scene, after the route; draft after a completed part and before release.'),
  directorId: id.describe('Who directs: a fresh reviewer who has not written the work where one is available, otherwise the writing agent itself, which then says so in independent.'),
  independent: z.boolean().describe('True only when the director did not write the work.'),
  nodeId: id.optional().describe('Supply with findings to record the direction.'),
  findings: z.array(z.object({
    principleId: id,
    verdict: z.enum(['holds', 'fails', 'not-this-story']),
    evidence: text(10, 4_000).describe('Where in the text and the model it holds or fails, citing passages, Events, Cuts and lives; for not-this-story, why the principle cannot apply here.'),
    modelChange: text(10, 4_000).nullable().default(null).describe('For fails: what must change in the model first, before the prose.'),
  }).strict()).max(40).optional().describe('Omit to receive the direction task; supply to record it.'),
  summary: text(10, 4_000).optional(),
}).strict();

export const directionInstructions = `The director is the other half of the loop that made the Book of Conditions good: someone who knows what makes a good story holds the work to it, and every failure sends the writer back into the model. Run it at the world stage, after the route and before the first scene, and at the draft stage, after each completed part and before release. Give the task to a fresh reviewer who has not written the work where you can, and record its findings under that director; otherwise direct yourself and say so. Assume each principle fails until the text and the model show it holds, and cite both. What is interesting differs between stories, and that decides what the story shows, never how much is modeled: always go deeper and model more, including much that never appears in the story, as the background processes of reality. Only a principle that cannot apply (no real people, no departure from history) may be marked not-this-story, with the reason. Then look for what this story needs that no principle names. A direction that finds nothing to change is suspect; look again. Every failure is answered in the model first (Events and their descriptions, lives, Cuts, mechanisms, long developments), then in the prose; link each answering record to the direction with answers. Scene preparation and release stop until the bound model has changed and a record answers the direction.`;

function readDirections(view, storyRootId) {
  const answered = new Set((view.edges ?? []).filter((edge) => edge.relation === 'answers' && edge.target?.kind === 'node').map((edge) => edge.target.node_id));
  return (view.nodes ?? []).filter((node) => node.node_type === 'storytelling.direction' && node.subject === storyRootId).map((node) => {
    let data = null; try { data = JSON.parse(node.text).data; } catch { data = null; }
    return data?.schema === DIRECTION_SCHEMA ? { node, data, answered: answered.has(node.id) } : null;
  }).filter(Boolean).sort((a, b) => (a.node.value_time ?? 0) - (b.node.value_time ?? 0));
}

// The direction state of a story: the latest direction of each stage and whether its failures have been answered in
// the model (the bound model changed since it was recorded) and in the record (an answers link).
export function directionState(view, storyRootId, boundModelHash) {
  const all = readDirections(view, storyRootId);
  const latest = (stage) => all.filter((item) => item.data.stage === stage).at(-1) ?? null;
  const open = (item) => item && item.data.findings.some((finding) => finding.verdict === 'fails')
    && (!item.answered || item.data.modelHash === boundModelHash);
  return { world: latest('world'), draft: latest('draft'), unanswered: all.filter(open).map((item) => ({ nodeId: item.node.id, stage: item.data.stage,
    failing: item.data.findings.filter((finding) => finding.verdict === 'fails').map((finding) => finding.principleId),
    modelUnchanged: item.data.modelHash === boundModelHash, answered: item.answered })) };
}

export async function direct(service, raw) {
  const input = directionSchema.parse(raw);
  const accessScopes = [...new Set(input.accessScopes)].sort();
  const view = await service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes });
  const modelHash = view.graph?.source?.model_hash ?? view.graph?.source_snapshot?.model_hash ?? null;
  const principles = principlesFor(input.stage);
  if (!input.findings) {
    const open = modelHash ? await readOpenQuestions(service, { modelHash, graphHash: input.graphHash, accessScopes, limit: 16 }).catch(() => null) : null;
    const rendered = input.stage === 'draft' ? await service.renderNarrativeGraph?.({ graphHash: input.graphHash, rootId: input.storyRootId, accessScopes }).catch(() => null) : null;
    return { schema: 'meaning-model-story-direction-task/v1', stage: input.stage, directorId: input.directorId, independent: input.independent, principles,
      model: open && { questions: open.questions, jumps: open.jumps, depth: open.depth }, text: rendered?.text ?? null,
      instructions: `${directionInstructions} For each principle, give holds or fails with evidence from the text and the model, and for each failure what must change in the model first. Then call life_story_direct again with findings to record the direction.`,
      worked: 'The Book of Conditions records its own loop in examples/book-of-conditions/UNDERSTANDING-NOTES.md: each note names its target Events, why, what changed in the model first and what changed in the prose.' };
  }
  const expected = new Set(principles.map((item) => item.id));
  const given = input.findings.map((item) => item.principleId);
  if (new Set(given).size !== given.length || given.some((principleId) => !expected.has(principleId)) || [...expected].some((principleId) => !given.includes(principleId))) {
    throw new Error(`A ${input.stage} direction gives exactly one finding for each of its principles: ${[...expected].join(', ')}.`);
  }
  const inapplicable = input.findings.filter((item) => item.verdict === 'not-this-story' && !directorPrinciples.find((principle) => principle.id === item.principleId)?.canBeInapplicable);
  if (inapplicable.length) throw new Error(`Only a principle that cannot apply may be marked not-this-story; ${inapplicable.map((item) => item.principleId).join(', ')} always apply. What is interesting decides what the story shows, never how much the world is modeled.`);
  const unplanned = input.findings.filter((item) => item.verdict === 'fails' && !item.modelChange);
  if (unplanned.length) throw new Error(`Say what must change in the model first for each failure: ${unplanned.map((item) => item.principleId).join(', ')}.`);
  if (!input.nodeId || !input.summary) throw new Error('Recording a direction needs nodeId and summary.');
  const record = await prepareAuthorRecord(service, { graphHash: input.graphHash, requestId: input.requestId, nodeId: input.nodeId, storyRootId: input.storyRootId,
    authorId: input.directorId, accessScopes, kind: 'direction', text: input.summary,
    data: { schema: DIRECTION_SCHEMA, stage: input.stage, directorId: input.directorId, independent: input.independent, modelHash, findings: input.findings } });
  const stored = await service.applyNarrativeBatch({ requestId: input.requestId, previousGraphHash: input.graphHash, narrativeBatch: record.narrativeBatch });
  const failing = input.findings.filter((item) => item.verdict === 'fails');
  return { ...stored, ...record.receipt, schema: 'meaning-model-story-direction-record/v1', directionNodeId: input.nodeId, stage: input.stage, failing: failing.map((item) => item.principleId),
    nextStep: failing.length
      ? `Answer each failure in the model first: revise it (life_model_revise), rebind the story graph, and record what you changed with answers pointing to ${input.nodeId}; then revise the prose from the deeper model. Scene preparation and release stop until the bound model has changed and a record answers this direction.`
      : 'Nothing failed. A direction that finds nothing to change is suspect: if it was a self-direction, give the task to a fresh reviewer.' };
}
