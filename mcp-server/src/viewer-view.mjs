// The view a model chooses for its reader. What a model records can be far more than a reader takes in at once: a
// hundred reviews, every link the construction declared. So the model says what the viewer opens with: settings in
// the viewer's own address vocabulary, the rows to show, the links and notes worth seeing with the reason each matters,
// and levels of detail a reader turns up through. The view is recorded as one Understanding Node, a decision held by
// the modeler about the model and every record the view names, superseding the view it replaces. The viewer opens the
// newest view not superseded and says that the model chose it.
import * as z from 'zod/v4';
import { boundModelHash, notePayload, readGraph, recordUnderstanding, targetSchema } from './construction-record.mjs';
import { resolveAppendHead } from './graph-head.mjs';
import { VIEW_SCHEMA, viewSettingsProblems } from '../viewer/public/view-settings.js';

const id = z.string().trim().min(1).max(256);
const why = z.string().trim().min(1).max(600).describe('Why this matters to the reader, in a sentence the viewer shows beside it.');
const [understandingRecordTarget, nodeTarget] = targetSchema.options;
// Viewer selections name whole records in this graph's bound model. Unlike an Understanding Node's about target,
// the browser cannot follow an external modelHash or a JSON Pointer path.
const recordTarget = understandingRecordTarget.pick({ record: true }).strict();
const settings = z.record(z.string(), z.string()).default({})
  .describe('Viewer address settings as strings, for example {"show":"processes,causal,notes","t0":"1800","t1":"1876","view":"together"}; the camera is the reader\'s and cannot be set.');
const row = recordTarget.describe('A whole Cut (cut:<id>) or process (process:<id>) in the bound model whose row the view shows; modelHash and path qualifiers are not supported.');
const highlight = z.union([recordTarget.extend({ why }), nodeTarget.extend({ why })])
  .describe('A displayed link (event_relation:<id>, excluding containment and about links), moment (event:<id>), reading (cut:<id>) or graph node ({nodeId}, such as a note), with why it matters. Model records must be whole records of the bound model; modelHash and path qualifiers are not supported.');
const ROW_KINDS = ['cut', 'process'], HIGHLIGHT_KINDS = ['event_relation', 'event', 'cut'];
const level = z.object({
  label: z.string().trim().min(1).max(80).describe('What this level adds, for example "+ where their time goes".'),
  settings, rows: z.array(row).max(16).default([]), highlights: z.array(highlight).max(16).default([]),
}).strict();
export const viewerViewSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u), requestId: id, accessScopes: z.array(id).min(1).max(64),
  holder: id.describe('Your holder id, the one your other Understanding Nodes use.'),
  title: z.string().trim().min(1).max(120).describe('What the reader is looking at, in a few words.'),
  caption: z.string().trim().min(1).max(1_200).describe('One to three sentences: what this view shows and what to notice.'),
  settings, rows: z.array(row).max(16).default([]), highlights: z.array(highlight).max(24).default([]),
  levels: z.array(level).max(6).default([]).describe('Levels of detail after the view itself, each adding settings, rows and highlights; the viewer adds Everything last.'),
  level: z.number().int().min(0).default(0).describe('The level the view opens at: 0 is the view itself.'),
}).strict().superRefine((input, context) => {
  const steps = [['', input], ...input.levels.map((item, index) => [`levels[${index}].`, item])];
  for (const [where, step] of steps) {
    for (const problem of viewSettingsProblems(step.settings)) context.addIssue({ code: 'custom', path: [`${where}settings`], message: problem });
    for (const target of step.rows) if (!ROW_KINDS.includes(target.record.split(':')[0])) context.addIssue({ code: 'custom', path: [`${where}rows`], message: `${target.record}: a row is shown for a Cut or a process (${ROW_KINDS.join(', ')}).` });
    for (const target of step.highlights) if (target.record && !HIGHLIGHT_KINDS.includes(target.record.split(':')[0])) context.addIssue({ code: 'custom', path: [`${where}highlights`], message: `${target.record}: highlight a link, moment, reading or graph node (${HIGHLIGHT_KINDS.join(', ')}, or nodeId).` });
  }
  if (input.level > input.levels.length) context.addIssue({ code: 'custom', path: ['level'], message: `level ${input.level} is past the ${input.levels.length} levels given.` });
});

const targetKey = (target) => target.record ?? `node:${target.nodeId}`;
const bare = (target) => (target.record ? { record: target.record } : { nodeId: target.nodeId });
const order = (node) => (Number.isFinite(node.value_time) ? node.value_time : -Infinity);

// The view the viewer opens now: the newest view note no other view note supersedes.
export function currentViewNote(graph) {
  const views = graph.nodes.filter((node) => notePayload(node).data?.schema === VIEW_SCHEMA);
  const ids = new Set(views.map((node) => node.id));
  const superseded = new Set(graph.edges.filter((edge) => edge.relation === 'supersedes' && ids.has(edge.source?.node_id) && edge.target?.kind === 'node')
    .map((edge) => edge.target.node_id));
  return views.filter((node) => !superseded.has(node.id)).sort((a, b) => order(a) - order(b)).at(-1) ?? null;
}

export async function recordViewerView(service, raw) {
  const input = viewerViewSchema.parse(raw);
  const scopes = [...new Set(input.accessScopes)].sort();
  const head = await resolveAppendHead(service, input.graphHash, input.requestId);
  const graph = await readGraph(service, head.graphHash, scopes);
  const modelHash = boundModelHash(graph);
  if (!modelHash) throw new Error('The graph is not bound to a model; a view chooses how a model is shown.');
  const { model } = await service.inspectModel({ modelHash, includeDefinition: true });
  const events = new Set((model.meaning_model?.events ?? []).map((event) => event.id));
  const relations = new Map((model.meaning_model?.event_relations ?? []).map((relation) => [relation.id, relation]));
  for (const [where, step] of [['settings', input], ...input.levels.map((item, index) => [`levels[${index}].settings`, item])]) {
    for (const key of ['scope', 'focus']) if (step.settings[key] && !events.has(step.settings[key])) throw new Error(`${where}.${key} names ${step.settings[key]}, which is not an Event in the model.`);
    for (const target of step.highlights) {
      if (!target.record?.startsWith('event_relation:')) continue;
      const relation = relations.get(target.record.slice('event_relation:'.length));
      // Match the links omitted from viewer-data's relation projection, including legacy about links.
      if (relation && (relation.kind === 'contains' || relation.kind === 'about'
        || (relation.kind === 'other' && /^about\b/iu.test(String(relation.description ?? ''))))) {
        throw new Error(`${target.record} is a containment or about link, which the viewer does not support as a highlight. Choose a displayed link, Event, Cut or graph node.`);
      }
    }
  }
  // The view is about the model and about every record it names, so recording it checks that each one exists.
  const about = new Map([[`record:model:${model.id}`, { record: `model:${model.id}` }]]);
  for (const step of [input, ...input.levels]) for (const target of [...step.rows, ...step.highlights]) about.set(targetKey(target), bare(target));
  if (about.size > 32) throw new Error(`A view names ${about.size - 1} records; name at most 31, the ones a reader most needs.`);
  const previous = currentViewNote(graph);
  const viewId = `understanding.view.${input.requestId.replace(/[^A-Za-z0-9._-]+/gu, '-')}`;
  const recorded = await recordUnderstanding(service, {
    graphHash: head.graphHash, requestId: input.requestId, accessScopes: scopes, holder: input.holder,
    notes: [{ nodeId: viewId, kind: 'decision', title: input.title, text: input.caption, about: [...about.values()],
      links: previous ? [{ relation: 'supersedes', targetNodeId: previous.id }] : [],
      data: { schema: VIEW_SCHEMA, settings: input.settings, rows: input.rows, highlights: input.highlights, levels: input.levels, level: input.level } }],
  });
  return { schema: 'meaning-model-viewer-view/v1', graphHash: recorded.graphHash, previousGraphHash: recorded.previousGraphHash, viewId,
    supersedes: previous?.id ?? null, levels: input.levels.length, highlights: input.highlights.length + input.levels.reduce((sum, item) => sum + item.highlights.length, 0),
    graphMutation: true, worldMutation: false,
    nextStep: 'A viewer opened on this graph without settings of its own opens this view, marked as chosen by the model; a live viewer following the graph switches to it unless the reader has changed the settings, and then offers it. Record a new view when what the reader needs to see changes.' };
}

export function registerViewerViewTool(server, service, { toolResult }) {
  server.registerTool('life_model_viewer_view', {
    title: 'Choose what the viewer shows',
    description: 'Choose what the viewer shows a reader when it opens, and say why. Most of what a model records is not what a reader should see first: choose the rows that show how things change, the links and notes that explain it, and the moment and scale to look at. Curves alone hide why they move: keep the causal links (the ones you highlight are drawn bright, the other links of the rows on show faintly), your own notes beside what they are about, and a story\'s pages over the moments they tell (show prose); narrow the layers only for a reason. Give settings in the viewer\'s address vocabulary (show, rows, t0 and t1, view, detail, scope, flat, undated and the rest; a reader\'s Display panel sets the same ones; the camera is the reader\'s), the rows to show by a Cut or process they carry, highlights with why each matters (links, moments, readings, or graph nodes such as your notes), and up to six levels of detail a reader turns up through, each labelled with what it adds; the viewer adds Everything last. The view is recorded as your decision, an Understanding Node about the model and every record it names, and a new view supersedes the previous one. The viewer opens the newest view and marks it as chosen by the model; a reader who has changed the settings keeps them and is offered the new view.',
    inputSchema: viewerViewSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => toolResult(await recordViewerView(service, input)));
}
