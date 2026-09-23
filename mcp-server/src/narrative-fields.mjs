// Fields accepted by narrative graph registration and revision, the stored fields of the engine's
// NarrativeNode and NarrativeEdge. Query projections add derived node fields (boundary,
// content_included); strip to these before resubmitting a graph. An edge's explanation is stored.
export const NODE_FIELDS = Object.freeze(['id', 'node_type', 'role', 'title', 'text', 'summary', 'epistemic_status', 'evidence_type', 'holder', 'subject', 'estimator', 'uncertainty', 'authority', 'value_time', 'evidence_cutoff', 'interval', 'access_scopes', 'render', 'training', 'provenance']);
export const EDGE_FIELDS = Object.freeze(['id', 'source', 'target', 'family', 'relation', 'order', 'explanation', 'access_scopes', 'provenance']);
const pick = (record, fields) => Object.fromEntries(Object.entries(record).filter(([key, value]) => fields.includes(key) && value !== null && value !== undefined));
export const stripNodeForRevision = (node) => pick(node, NODE_FIELDS);
export const stripEdgeForRevision = (edge) => pick(edge, EDGE_FIELDS);
