import * as z from 'zod/v4';

const id = z.string().trim().min(1).max(1024);
const boundary = z.object({ nodeId: id, boundary: z.enum(['start', 'end']) }).strict();
export const documentSpanSchema = z.object({
  schema: z.literal('meaning-model-document-span/v1'),
  documentId: id,
  start: boundary,
  end: boundary,
}).strict();
export const documentProjectSchema = z.object({
  graphHash: z.string().regex(/^[a-f0-9]{64}$/u),
  rootId: id,
  accessScopes: z.array(id).max(64).default([]),
}).strict();

const nodeId = (endpoint) => endpoint?.kind === 'node' ? endpoint.node_id : null;

// Positions belong to this exact rendered projection, not to the modeled world's clock.
// Persist boundary references in the graph; recompute these byte offsets after every edit.
export function projectDocument({ rendered, nodes, edges, rootId }) {
  if (rendered.join_policy !== 'blank_line' || !Array.isArray(rendered.units)
    || rendered.roots?.length !== 1 || rendered.roots[0] !== rootId) {
    throw new Error('Document projection requires one exact native blank-line render.');
  }
  const expectedText = rendered.units.map((unit) => unit.text).filter((text) => text !== '').join('\n\n');
  if (expectedText !== rendered.text || rendered.units.some((unit) => typeof unit.text !== 'string')) {
    throw new Error('Rendered document units do not reproduce the canonical text.');
  }
  const units = []; const positions = new Map(); let offset = 0; let hasText = false;
  for (const unit of rendered.units) {
    if (positions.has(unit.node_id)) throw new Error('Document projection requires unique rendered node identities.');
    if (unit.text && hasText) offset += 2; // The canonical renderer inserts a blank line between nonempty units.
    const start = offset;
    offset += Buffer.byteLength(unit.text, 'utf8');
    const position = { nodeId: unit.node_id, title: unit.title ?? null, role: unit.role,
      contentHash: unit.content_hash, start, end: offset, length: offset - start };
    units.push(position); positions.set(unit.node_id, position);
    if (unit.text) hasText = true;
  }
  const visibleNodes = new Map(nodes.filter((node) => node.content_included !== false && !node.boundary).map((node) => [node.id, node]));
  const children = new Map(); const next = new Map();
  for (const edge of edges) {
    const from = nodeId(edge.source); const to = nodeId(edge.target);
    if (edge.family === 'structural' && visibleNodes.has(from) && visibleNodes.has(to)) {
      const links = edge.relation === 'contains' ? children : edge.relation === 'next' ? next : null;
      if (!links) continue;
      if (!links.has(from)) links.set(from, []);
      links.get(from).push(to);
    }
  }
  // Eligibility includes nonrendered containers actually visited from this root.
  // Match the native traversal's contains-before-next rule: a different root
  // cannot become an endpoint merely because it shares one rendered descendant.
  const eligible = new Set(); const pending = [rootId];
  for (let i = 0; i < pending.length; i++) {
    const current = pending[i];
    if (!visibleNodes.has(current) || eligible.has(current)) continue;
    eligible.add(current);
    pending.push(...(children.get(current) ?? next.get(current) ?? []));
  }
  // A split retains its original container. Its boundaries follow its currently rendered
  // descendants; this does not infer that every child inherits every semantic attachment.
  const extent = (startId) => {
    if (!eligible.has(startId)) return null;
    // The requested root denotes the whole native projection, including next
    // chains and an empty document. Other containers denote contains descendants.
    if (startId === rootId) return { start: 0, end: Buffer.byteLength(rendered.text, 'utf8') };
    const pending = [startId]; const seen = new Set(); const spans = [];
    for (let i = 0; i < pending.length; i++) {
      const current = pending[i];
      if (seen.has(current)) continue;
      seen.add(current);
      if (positions.has(current)) spans.push(positions.get(current));
      pending.push(...(children.get(current) ?? []));
    }
    return spans.length ? { start: Math.min(...spans.map((span) => span.start)), end: Math.max(...spans.map((span) => span.end)) } : null;
  };
  const spans = [];
  for (const node of visibleNodes.values()) {
    if (node.node_type !== 'document.span') continue;
    let parsed;
    try { parsed = documentSpanSchema.safeParse(JSON.parse(node.text)); } catch { parsed = { success: false }; }
    if (parsed.success && parsed.data.documentId !== rootId) continue;
    const base = { nodeId: node.id, title: node.title ?? null };
    if (!parsed.success || node.role !== 'metadata' || node.render === 'include') {
      spans.push({ ...base, status: 'unresolved', reason: 'invalid_span_record' }); continue;
    }
    const definition = parsed.data;
    const from = extent(definition.start.nodeId); const to = extent(definition.end.nodeId);
    if (!from || !to) {
      spans.push({ ...base, definition, status: 'unresolved', reason: 'boundary_not_in_projection' }); continue;
    }
    const start = from[definition.start.boundary]; const end = to[definition.end.boundary];
    if (end < start) {
      spans.push({ ...base, definition, status: 'unresolved', reason: 'reversed_boundaries' }); continue;
    }
    // Preserve the graph's open relationship vocabulary; a span need not be attached
    // to a particular process kind, world, author, or storytelling profile.
    const links = edges.filter((edge) => nodeId(edge.source) === node.id || nodeId(edge.target) === node.id).map((edge) => structuredClone(edge));
    spans.push({ ...base, definition, status: 'resolved', start, end, length: end - start, links });
  }
  return { schema: 'meaning-model-document-projection/v1', graphHash: rendered.graph_hash,
    projectionHash: rendered.projection_hash, documentId: rootId, coordinate: 'utf8_byte',
    interval: 'half_open', byteLength: Buffer.byteLength(rendered.text, 'utf8'), units, spans,
    worldMutation: false, semantics: 'Document positions only. Process values, world intervals, and reader interpretations are not inferred or retimed.' };
}

export async function projectNarrativeDocument(service, raw) {
  const input = documentProjectSchema.parse(raw);
  const [rendered, view] = await Promise.all([
    service.renderNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, rootIds: [input.rootId], accessScopes: input.accessScopes }),
    service.queryNarrativeGraph({ graphHash: input.graphHash, expectedGraphHash: input.graphHash, mode: 'full', includeContent: true, accessScopes: input.accessScopes }),
  ]);
  if (view.graph_hash !== input.graphHash || rendered.graph_hash !== input.graphHash || view.content_included !== true) {
    throw new Error('Document projection requires matching exact graph revisions and visible content.');
  }
  return projectDocument({ rendered, nodes: view.nodes, edges: view.edges, rootId: input.rootId });
}
