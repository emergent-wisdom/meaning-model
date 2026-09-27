// Depiction is an author's declaration, never inferred from a passage's vocabulary.
// Keep explicit exceptions on the native node and bind them to its exact text.
import { createHash } from 'node:crypto';

export const NO_EVENT_LINK_PREFIX = 'meaning-model:no-event-link/v1:';
// Private capability used only after construction import validates a portable history.
// Symbols cannot be supplied through a JSON/MCP authoring request.
export const NARRATIVE_HISTORY_REPLAY = Symbol('validated narrative history replay');
export const passageTextHash = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0;

export function isRenderedPassage(node) {
  if (node.render !== 'include' || !String(node.text ?? '').trim()
    || node.role === 'externalized_reflection') return false;
  if (node.role === 'document_root') {
    const lines = String(node.text).split(/\r?\n/u).filter((line) => line.trim());
    if (lines.every((line) => /^ {0,3}#{1,6}(?:[ \t]+.*)?[ \t]*$/u.test(line))) return false;
  }
  return true;
}

export function noEventLinkDeclaration(text, reason, author) {
  if (!nonblank(reason) || reason.trim().length < 10 || reason.length > 4_000) {
    throw new Error('noLinkReason must explain why this passage has no Event depiction (10–4000 characters).');
  }
  if (!nonblank(author)) throw new Error('A no-link declaration must identify its author (the calling agent).');
  return NO_EVENT_LINK_PREFIX + JSON.stringify({ reason: reason.trim(), textHash: passageTextHash(text), author: author.trim() });
}

export function readNoEventLinkDeclaration(node) {
  const declarations = (node.provenance ?? []).filter((value) => typeof value === 'string' && value.startsWith(NO_EVENT_LINK_PREFIX));
  for (const value of declarations.toReversed()) {
    try {
      const declaration = JSON.parse(value.slice(NO_EVENT_LINK_PREFIX.length));
      if (declaration.textHash === passageTextHash(node.text)
        && nonblank(declaration.reason) && declaration.reason.trim().length >= 10 && declaration.reason.length <= 4_000
        && nonblank(declaration.author)) return declaration;
    } catch { /* Malformed or historical declarations do not waive current grounding. */ }
  }
  return null;
}

export const isEventRenderEdge = (edge) => edge.family === 'grounding' && edge.relation === 'renders'
  && edge.source?.kind === 'node' && edge.target?.kind === 'anchor' && edge.target.anchor_kind === 'event';

export function passageGrounding(graph) {
  const linked = new Map();
  for (const edge of graph.edges ?? []) if (isEventRenderEdge(edge)) {
    const ids = linked.get(edge.source.node_id) ?? [];
    ids.push(edge.target.anchor_id); linked.set(edge.source.node_id, ids);
  }
  return (graph.nodes ?? []).filter(isRenderedPassage).map((node) => ({
    nodeId: node.id, eventIds: [...new Set(linked.get(node.id) ?? [])].sort(),
    noLink: readNoEventLinkDeclaration(node),
  }));
}

// Old immutable graphs remain readable and can be repaired incrementally. New prose,
// changed prose and removal of a previously declared dependency must satisfy the rule.
export function assertPassageGrounding(graph, { previous = null, nodeIds = null } = {}) {
  let selected = nodeIds === null ? null : new Set(nodeIds);
  if (previous && selected === null) {
    const old = new Map((previous.nodes ?? []).map((node) => [node.id, node]));
    const signature = (node) => JSON.stringify([node.text ?? '', node.render, node.role, node.node_type,
      (node.provenance ?? []).filter((value) => String(value).startsWith(NO_EVENT_LINK_PREFIX))]);
    selected = new Set((graph.nodes ?? []).filter((node) => !old.has(node.id) || signature(old.get(node.id)) !== signature(node)).map((node) => node.id));
    const nextEdges = new Map((graph.edges ?? []).map((edge) => [edge.id, edge]));
    for (const edge of previous.edges ?? []) if (isEventRenderEdge(edge)) {
      const next = nextEdges.get(edge.id);
      if (!next || !isEventRenderEdge(next) || next.source.node_id !== edge.source.node_id || next.target.anchor_id !== edge.target.anchor_id) selected.add(edge.source.node_id);
    }
  }
  const missing = passageGrounding(graph).filter((item) => (!selected || selected.has(item.nodeId)) && !item.eventIds.length && !item.noLink);
  if (missing.length) throw new Error(`Rendered passages need explicit grounding/renders Event links or a current per-passage noLinkReason: ${missing.map((item) => item.nodeId).join(', ')}. Use life_narrative_grounding_propose and life_narrative_grounding_apply for existing prose. Nothing was written.`);
}

// Used by authoring helpers. An explicit mapping replaces only Event/renders links;
// Cut anchors and all other semantic/provenance links keep their identities.
export function declarePassageGrounding(graph, node, declaration, { author, edgeId, provenance = [] }) {
  if (declaration.renders === undefined && declaration.noLinkReason === undefined) return;
  const eventIds = declaration.renders ?? [];
  if (new Set(eventIds).size !== eventIds.length) throw new Error(`Passage ${node.id} repeats a renders Event ID.`);
  if (eventIds.length && declaration.noLinkReason !== undefined) throw new Error(`Passage ${node.id} must choose renders Events or noLinkReason, not both.`);
  if (!eventIds.length && declaration.noLinkReason === undefined) throw new Error(`Passage ${node.id}: an empty renders list needs an explicit noLinkReason.`);
  graph.edges = graph.edges.filter((edge) => !(isEventRenderEdge(edge) && edge.source.node_id === node.id));
  node.provenance = (node.provenance ?? []).filter((value) => !String(value).startsWith(NO_EVENT_LINK_PREFIX));
  if (declaration.noLinkReason !== undefined) node.provenance.push(noEventLinkDeclaration(node.text, declaration.noLinkReason, author));
  for (const [index, eventId] of eventIds.entries()) {
    const id = edgeId(index);
    if (graph.edges.some((edge) => edge.id === id)) throw new Error(`Grounding edge ID already exists: ${id}.`);
    graph.edges.push({ id, source: { kind: 'node', node_id: node.id }, target: { kind: 'anchor', anchor_kind: 'event', anchor_id: eventId },
      family: 'grounding', relation: 'renders', access_scopes: [...(node.access_scopes ?? [])], provenance: [...provenance] });
  }
}
