// Fields accepted by narrative graph registration and revision, the stored fields of the engine's
// NarrativeNode and NarrativeEdge. Query projections add derived node fields (boundary,
// content_included); strip to these before resubmitting a graph. An edge's explanation is stored.
export const NODE_FIELDS = Object.freeze(['id', 'node_type', 'role', 'title', 'text', 'summary', 'epistemic_status', 'evidence_type', 'holder', 'subject', 'estimator', 'uncertainty', 'authority', 'value_time', 'evidence_cutoff', 'interval', 'access_scopes', 'render', 'training', 'provenance']);
export const EDGE_FIELDS = Object.freeze(['id', 'source', 'target', 'family', 'relation', 'order', 'explanation', 'access_scopes', 'provenance']);
const pick = (record, fields) => Object.fromEntries(Object.entries(record).filter(([key, value]) => fields.includes(key) && value !== null && value !== undefined));
export const stripNodeForRevision = (node) => pick(node, NODE_FIELDS);
export const stripEdgeForRevision = (edge) => pick(edge, EDGE_FIELDS);
// A query adds these to each node for display. A write drops them, so a record read back from a query can be
// sent again as it came (found by the 2026-09-23 instruction test: a copied record failed on its boundary field).
export const NODE_PROJECTION_FIELDS = Object.freeze(['boundary', 'content_included']);
// A node read without its content has no text; writing it back would store it with empty text, so it is refused.
export function withoutProjectionFields(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || !NODE_PROJECTION_FIELDS.some((field) => Object.hasOwn(node, field))) return node;
  if (node.content_included === false) {
    throw new Error(`Node ${node.id ?? '(no id)'} was read without its content (content_included: false); read it again with includeContent true before writing it back, or its text would be lost.`);
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => !NODE_PROJECTION_FIELDS.includes(key)));
}
