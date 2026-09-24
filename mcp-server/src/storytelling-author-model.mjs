import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(256);
const explanation = z.string().trim().min(1).max(4_000);
const dimension = z.object({
  id, meaning: explanation, comparisonQuestion: explanation,
  unit: id, minimum: z.number().finite(), maximum: z.number().finite(), value: z.number().finite(),
}).strict().superRefine((value, context) => {
  if (value.maximum <= value.minimum) context.addIssue({ code: 'custom', path: ['maximum'], message: 'An author dimension needs an increasing range.' });
  if (value.value < value.minimum || value.value > value.maximum) context.addIssue({ code: 'custom', path: ['value'], message: 'Author dimension value lies outside its declared range.' });
});

export const authorModelSchema = z.object({
  schema: z.literal('meaning-model-story-author-model/v1'),
  modeledAuthorId: id,
  mode: z.enum(['real_author', 'fictional_author']),
  label: id,
  basis: z.array(z.object({
    id, kind: z.enum(['author_statement', 'writing_sample', 'interpretation', 'invented']),
    description: explanation,
    sourceNodeId: id.optional(),
    excerpt: z.string().trim().min(1).max(16_000).optional(),
  }).strict()).min(1).max(64),
  dispositions: z.array(z.object({
    id, basisIds: z.array(id).min(1).max(64),
    outlookOrHabit: explanation,
    writingConsequences: z.array(explanation).min(1).max(12),
    usefulContexts: explanation,
    risksOrCounterweights: explanation,
    dimensionIds: z.array(id).max(64).default([]),
  }).strict()).min(1).max(32),
  dimensions: z.array(dimension).max(64).default([]),
}).strict().superRefine((model, context) => {
  for (const field of ['basis', 'dispositions', 'dimensions']) {
    const ids = model[field].map((item) => item.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: [field], message: `${field} IDs must be unique.` });
  }
  model.basis.forEach((basis, index) => {
    if (model.mode === 'real_author' && basis.kind === 'invented') {
      context.addIssue({ code: 'custom', path: ['basis', index, 'kind'], message: 'Invented material cannot establish a real author model; use a fictional author or supplied/observed evidence.' });
    }
    if (basis.kind === 'writing_sample' && (!basis.sourceNodeId || !basis.excerpt)) {
      context.addIssue({ code: 'custom', path: ['basis', index], message: 'A writing sample requires a stored sourceNodeId and exact excerpt.' });
    }
    if (basis.excerpt && !basis.sourceNodeId) context.addIssue({ code: 'custom', path: ['basis', index, 'sourceNodeId'], message: 'An excerpt requires a stored source.' });
  });
  const basisIds = new Set(model.basis.map((item) => item.id));
  const dimensionIds = new Set(model.dimensions.map((item) => item.id));
  model.dispositions.forEach((disposition, index) => {
    for (const [field, available] of [['basisIds', basisIds], ['dimensionIds', dimensionIds]]) {
      const values = disposition[field];
      if (new Set(values).size !== values.length || values.some((value) => !available.has(value))) {
        context.addIssue({ code: 'custom', path: ['dispositions', index, field], message: `${field} must name distinct entries in this author model.` });
      }
    }
  });
});

export const voiceReviewInstructions = `Automatically review the actual prose after a draft and after a substantive revision. Ask explicitly: Does this work express the modeled author's voice at this point in their life, and where does the text support or undermine that reading? Are the important characters' voices and actions credible and recognizable through their own underlying processes, including meaningful changes by situation? Assess the author separately and give an individual finding for each relevant principal character. If author modeling was omitted, record that limit rather than inventing an author profile. For characters who act without speaking, examine behavior and viewpoint where available rather than inventing dialogue.
Each finding must distinguish intended voice from observed effects, cite exact draft passages and identify the relevant author-model dispositions or character-process evidence through graph node IDs or model paths. Explain recognizability, useful distinction or similarity, and variation by situation; record weaknesses or uncertainty honestly. Give the smallest useful repair, or explain why to keep what works. Examine attention, narrative distance, rhythm, imagery, dialogue, action and omission where useful; do not replace reading with a checklist, enforced imitation or a quota for every trait. Distinguish purposeful narrator contrast or shared character language from an unintended flattening of voices. A voice is assessed against the chosen model and text, not claimed to be a real person's objectively true voice. A reader's interpretation of a narrator or character is not evidence of the real author's private beliefs or biography.
Store the assessment inside the graph using life_story_author_record with kind assessment, producing an actual externalized_reflection Understanding Node, not metadata or an exported review alone. Link about the exact reviewed draft/passage nodes and shaped_by the selected author model when present; link relevant graph process evidence as appropriate. In data preserve the reviewed graphHash, sourceSnapshotHash and modelHash, the selected author model ID and record hash when supplied, and per-subject findings with their prose citations and model evidence node IDs or paths. Use the exact identities and hashes available in the review task or graph; retrieve missing evidence rather than fabricate it, and identify unavailable evidence as a limit. These findings externalize the evidence and conclusions needed for revision, not hidden reasoning. Save them before treating voice review as complete. Use the optional authorModelNodeId in life_story_purpose_review so its advice uses the exact graph model rather than a caller summary. Literary effectiveness remains advisory, not a style score or hard gate.
When a voice is weak, distinguish a prose realization problem from an inadequately explained character process or author interpretation. A later deepening pass can strengthen an existing causal connection or its expression while preserving successful scenes and variation; more detail, difference or intensity is not automatically better. Reassess changed passages after revision and preserve earlier findings as historical evidence rather than rewriting them to match the new draft.`;

export const authorModelInstructions = `Develop or reuse a model of the author's voice before new prose, within the agreed brief and human involvement, derived from the author's life, which is modeled first in its own life model (life_story_world_record, stage author_reader). Store it with life_story_author_record, kind author_model, using data with schema meaning-model-story-author-model/v1. Its modeledAuthorId is the person/persona being modeled; the tool's authorId identifies the recorder. Keep the model author-only and separate from story-world character life trends. For an existing project, reuse its chosen model; an explicit request to omit author modeling or a bounded review/edit remains valid. Do not silently invent a model of the real user in an autonomous story run: create a clearly fictional author persona when authorial choices have been delegated and no real author model was supplied, recording that choice.
Model causes of style: supplied preferences or relevant experience, observations from actual writing samples, tentative interpretations, or invented persona history lead to outlook and habitual attention, which lead to concrete writing choices. In real_author mode use supplied material and distinguish interpretation from what the author actually said; a narrator's statements are not evidence of the author's biography or beliefs. Do not fabricate private experiences. Fictional author material must be labeled invented. The life itself belongs in the author's life model; this record holds the voice that life produces. Numerical dimensions can describe chosen comparisons and tendencies with explicit meanings, units, bounds and values; they are authored models, not universal personality scores. Existing numerical life exploration can inform a fictional author's development when useful; keep its samples and conclusions in the graph.
For new writing, explicitly locate the author at the time of composition: their life stage and current circumstances, relevant earlier life and writing history (including influences, experiments and habits changed or retained), and their reasons for writing this particular work now. Store supported or invented context as labeled basis entries and link its relevant effects through dispositions; no new record type is needed. Only experience available at that composition point may shape this version of the author. Use known real-author information; leave unavailable life history or motives explicitly unknown in the record summary, without inventing evidence or demanding private biography. For a delegated fictional persona, choose and record these elements as invented. Reasons can be multiple, conflicting, uncertain or evolving: curiosity, pleasure, craft, a commission, earning a living, remembrance or questioning a conviction are all possible. An exploratory work need not have a settled thesis. Keep reasons for undertaking the work separate from a chapter's purpose, narrator or character motives, and the effect actually achieved for a reader. The connections may shape subject, form, voice, emphasis or omission without requiring autobiographical exposition or a message in every scene. Revisit them when useful during review; preserve the earlier record and explicitly revise changed motives rather than retrofitting an intention to declare the draft successful.
The data object requires schema, modeledAuthorId, mode (real_author or fictional_author), label, basis and dispositions; dimensions is optional. Each basis entry has id, kind (author_statement, writing_sample, interpretation or invented), description, and optional sourceNodeId/excerpt. Writing samples require a stored source node and exact excerpt. Each disposition has id, names basisIds and explains outlookOrHabit, writingConsequences (an array), usefulContexts, risksOrCounterweights and optional dimensionIds. Optional dimensions have id, meaning, comparisonQuestion, unit, minimum, maximum and value. For example, work negotiating between institutions may prompt attention to who can interrupt or name a problem, expressed through asymmetrical dialogue; its counterweight is allowing uncalculated affection and encounters outside institutions. Keep the experience, interpretation and proposed literary effect distinct rather than assigning stock adjectives or equating a background with one inevitable style.
Carry the exact stored authorModelNodeId into scene preparation. In scene.authorApplication select relevant dispositionIds and describe intendedEffect, restraint and narratorRelation. Vary attention, distance, syntax, rhythm, image sources, treatment of dialogue, explanation and omission where the model gives a reason; these are examples, not required dimensions or sentence quotas. A contrasting narrator, an unusual register or deliberately leaving a disposition inactive can be appropriate. Do not force every disposition into every scene or make all characters sound like the author. The author, recorder, narrator and focal character are separate identities; author knowledge or beliefs do not grant character knowledge, narrator authority or fictional truth. No private author background should appear in prose merely because it shaped a choice.
Ground character speech and behavior in the characters' own modeled processes, not in the author model alone. Where consequential, connect what a character notices, wants, expects, understands and has learned to how they speak, withhold, act and respond to others. Consider relationship and status, emotional state, anticipation, surprise and adaptation as relevant causes rather than a required list of traits. The same person can speak differently in safety, negotiation or grief while retaining a recognizable history. Give these connections evidence in the existing model and graph; an adjective-only voice label, accent or catchphrase is not a substitute. Do not invent universal voice axes, force contrast between every pair of characters, or give a speaker knowledge unavailable to them. Shared language and deliberate resemblance can be meaningful.
${voiceReviewInstructions}
Record changed author models as new author_model records linked supersedes, then prepare and review affected prose against the chosen revision. Style-only changes need not invalidate an otherwise unchanged causal depth review; changes to story causes or disclosure do. The server validates structure, sources and provenance, not whether the model captures a person or produces distinctive writing.`;

export function authorModelSourceIds(model) {
  return [...new Set(model.basis.flatMap((basis) => basis.sourceNodeId ? [basis.sourceNodeId] : []))];
}

function sourceText(node) {
  if (node.node_type?.startsWith('storytelling.')) {
    try {
      const payload = JSON.parse(node.text);
      if (payload.schema === 'meaning-model-story-author-record/v1') return typeof payload.text === 'string' ? payload.text : undefined;
    } catch { /* Ordinary story passages contain plain text. */ }
  }
  return node.text;
}

// A cited source must actually be in the scope-visible graph. Existence and
// exact quotation are verifiable; biographical and stylistic claims are not.
export function validateAuthorModelSources(view, model) {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  for (const basis of model.basis) {
    if (!basis.sourceNodeId) continue;
    const source = nodes.get(basis.sourceNodeId);
    if (!source || typeof source.text !== 'string') throw new Error(`Author-model source is unknown, inaccessible or lacks content: ${basis.sourceNodeId}.`);
    if (basis.excerpt && !sourceText(source)?.includes(basis.excerpt)) throw new Error(`Author-model excerpt does not match source ${basis.sourceNodeId}.`);
  }
}

export function readAuthorModel(view, { nodeId, storyRootId }) {
  if (!view.content_included) throw new Error('Author model requires the scope-visible graph content.');
  const node = view.nodes.find((item) => item.id === nodeId);
  if (!node || node.node_type !== 'storytelling.author_model' || node.role !== 'metadata'
    || node.subject !== storyRootId || node.render !== 'exclude' || node.training !== 'exclude'
    || !node.access_scopes?.length) throw new Error('Author model is unavailable, belongs to another story, or lacks author-only storage.');
  let payload;
  try { payload = JSON.parse(node.text); } catch { throw new Error('Invalid stored author-model record.'); }
  if (payload.schema !== 'meaning-model-story-author-record/v1' || payload.kind !== 'author_model') throw new Error('Invalid stored author-model record.');
  const model = authorModelSchema.parse(payload.data);
  validateAuthorModelSources(view, model);
  for (const sourceId of authorModelSourceIds(model)) {
    const source = view.nodes.find((item) => item.id === sourceId);
    if (source.access_scopes?.length && node.access_scopes.some((scope) => !source.access_scopes.includes(scope))) {
      throw new Error('Stored author-model scopes exceed its cited evidence scopes.');
    }
  }
  const root = view.nodes.find((item) => item.id === payload.authoringClock?.rootId);
  if (!root || root.node_type !== 'understanding_process_root' || root.subject !== storyRootId
    || root.render !== 'exclude' || root.training !== 'exclude'
    || !view.edges.some((edge) => edge.relation === 'contains' && edge.source?.kind === 'node'
      && edge.source.node_id === root.id && edge.target?.kind === 'node' && edge.target.node_id === node.id)) {
    throw new Error('Author model lacks its author understanding-process root.');
  }
  // Explicit historical selections remain possible; no implicit latest-head lookup.
  return { nodeId: node.id, model };
}
