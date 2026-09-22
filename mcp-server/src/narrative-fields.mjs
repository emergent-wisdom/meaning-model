// Fields accepted by narrative graph registration and revision. Query projections add derived
// fields (boundary, content_included, explanation); strip to these before resubmitting a graph.
export const NODE_FIELDS = Object.freeze(['id', 'node_type', 'role', 'title', 'text', 'summary', 'epistemic_status', 'evidence_type', 'holder', 'subject', 'estimator', 'uncertainty', 'authority', 'value_time', 'evidence_cutoff', 'interval', 'access_scopes', 'render', 'training', 'provenance']);
export const EDGE_FIELDS = Object.freeze(['id', 'source', 'target', 'family', 'relation', 'order', 'access_scopes', 'provenance']);
const pick = (record, fields) => Object.fromEntries(Object.entries(record).filter(([key, value]) => fields.includes(key) && value !== null && value !== undefined));
export const stripNodeForRevision = (node) => pick(node, NODE_FIELDS);
export const stripEdgeForRevision = (edge) => pick(edge, EDGE_FIELDS);
