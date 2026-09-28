import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(1024);
const text = z.string().trim().min(1).max(8000);
const basisUnit = z.object({ nodeId: id, contentHash: z.string().min(1) }).strict();

// An optional record convention in the existing graph, not a new world clock.
export const documentProcessSchema = z.object({
  schema: z.literal('meaning-model-document-process/v1'),
  documentId: id,
  label: text,
  question: text,
  summary: text,
  basisSpanOrder: z.array(id).max(100).optional(),
  basisDocumentOrder: z.array(id).max(10000).optional(),
  states: z.array(z.object({
    label: text,
    spanId: id,
    description: text,
    evidence: z.array(z.object({ nodeId: id, excerpt: text }).strict()).min(1).max(16),
    basisUnits: z.array(basisUnit).max(1000).optional(),
  }).strict()).min(1).max(100),
}).strict();

const coveredUnits = (projection, span) => projection.units.filter((unit) =>
  unit.length > 0 && unit.start < span.end && unit.end > span.start);

export function prepareDocumentProcess(data, projection, nodes) {
  const parsed = documentProcessSchema.parse(data);
  if (parsed.documentId !== projection.documentId) throw new Error('Document process belongs to another document.');
  const byId = new Map(nodes.filter((node) => !node.boundary && node.content_included !== false).map((node) => [node.id, node]));
  const targetIds = new Set([parsed.documentId]);
  const states = parsed.states.map((state) => {
    const span = projection.spans.find((span) => span.nodeId === state.spanId);
    if (span?.status !== 'resolved') throw new Error(`Document process span is unavailable or unresolved: ${state.spanId}.`);
    const units = coveredUnits(projection, span);
    if (!units.length) throw new Error('Document process evidence needs a nonempty passage span.');
    targetIds.add(state.spanId);
    for (const evidence of state.evidence) {
      const node = byId.get(evidence.nodeId);
      if (!units.some((unit) => unit.nodeId === evidence.nodeId) || !node?.text?.includes(evidence.excerpt)) {
        throw new Error(`Document process quotation must match a current rendered passage inside its span: ${evidence.nodeId}.`);
      }
    }
    units.forEach((unit) => targetIds.add(unit.nodeId));
    return { ...state, basisUnits: units.map(({ nodeId, contentHash }) => ({ nodeId, contentHash })) };
  });
  const basisSpanOrder = states.map((state) => projection.spans.find((span) => span.nodeId === state.spanId))
    .sort((a, b) => a.start - b.start || a.end - b.end).map((span) => span.nodeId);
  const basisDocumentOrder = projection.units.map((unit) => unit.nodeId);
  return { data: { ...parsed, states, basisSpanOrder, basisDocumentOrder },
    targetIds: [...targetIds], scopeBasisIds: basisDocumentOrder };
}

export function projectDocumentProcesses({ projection, nodes, edges }) {
  const visible = nodes.filter((node) => !node.boundary && node.content_included !== false);
  const ids = new Set(visible.map((node) => node.id));
  const superseded = new Set(edges.filter((edge) => edge.relation === 'supersedes'
    && ids.has(edge.source?.node_id) && ids.has(edge.target?.node_id)).map((edge) => edge.target.node_id));
  const result = [];
  for (const node of visible) {
    if (superseded.has(node.id) || node.render === 'include' || !['metadata', 'externalized_reflection'].includes(node.role)) continue;
    let payload;
    try { payload = JSON.parse(node.text); } catch { continue; }
    const parsed = documentProcessSchema.safeParse(payload?.schema === 'meaning-model-story-author-record/v1' ? payload.data : payload);
    if (!parsed.success || parsed.data.documentId !== projection.documentId) continue;
    const process = parsed.data;
    const currentOrder = process.states.map((state) => projection.spans.find((span) => span.nodeId === state.spanId))
      .filter((span) => span?.status === 'resolved').sort((a, b) => a.start - b.start || a.end - b.end).map((span) => span.nodeId);
    const orderChanged = (process.basisSpanOrder && JSON.stringify(process.basisSpanOrder) !== JSON.stringify(currentOrder))
      || (process.basisDocumentOrder && JSON.stringify(process.basisDocumentOrder) !== JSON.stringify(projection.units.map((unit) => unit.nodeId)));
    const states = process.states.map((state) => {
      const span = projection.spans.find((span) => span.nodeId === state.spanId);
      if (span?.status !== 'resolved') return { ...state, status: 'unresolved', reason: span?.reason ?? 'span_not_visible' };
      const units = coveredUnits(projection, span);
      const basis = state.basisUnits;
      const unchanged = basis?.length === units.length && units.every((unit, i) =>
        unit.nodeId === basis[i].nodeId && unit.contentHash === basis[i].contentHash);
      return { ...state, status: unchanged && !orderChanged ? 'current' : 'needs_review',
        ...(orderChanged ? { reason: 'reading_order_changed' } : unchanged ? {} : { reason: basis ? 'passages_changed' : 'no_reviewed_passage_basis' }),
        start: span.start, end: span.end, startNodeId: span.definition.start.nodeId,
        spanTitle: span.title ?? state.spanId };
    });
    result.push({ ...process, nodeId: node.id, holder: node.holder ?? node.authority?.source ?? null,
      coordinate: 'document_position', interpretation: 'authored', states });
  }
  return result;
}
