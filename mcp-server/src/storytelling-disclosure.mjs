import { documentSpanSchema, projectDocument } from './document-projection.mjs';

// Disclosure is declared over existing passage identities. These diagnostics inspect
// visible links, not prose meaning, and never equate depiction with reader knowledge.
export const disclosureInstructions = `From the first exploration of a story, consider the processes of its telling as well as the events it tells. Follow how anticipation, dramatic pressure, rhythm, attention, humor, intimacy, disclosure or a process you discover changes as the text unfolds. Ask what produces a change, what it changes in the meaning of earlier passages, and what remains open. These are invitations to recursive exploration, not required tracks, a prescribed dramatic arc, or a reason to remove quietness and pleasure. Let exploratory writing alter this account and let the account suggest new writing. Review actual prose before treating an intended effect as achieved.
Automatically consider disclosure when preparing or revising prose: what can the reader already know, what particular facts does this passage reveal, and what remains withheld or ambiguous? Keep this separate from what each focal character knows in world time. A renders link says which Event is depicted, not that all its facts or motives are disclosed. Select small fact/context nodes and give scene.context their explicit readerKnownAt and viewpointKnownAt assignments; do not substitute an entire Event, life dossier or author biography for those facts.
When a delayed reveal, perspective difference, setup or reinterpretation matters, store its plan with life_story_author_record kind disclosure, linked to the actual passages and fact/model records. Use existing stable passage identities, reading order and optional document.span boundaries through life_document_project. No new clock system, book-as-Thing or numerical reader psychology is required. Keep an ordinary scene simple; there is no quota of secrets, fact nodes, subscenes or suspense values. If no special withholding or timing matters, say why the existing treatment suffices in the review rather than inventing a plot device.
When useful to inspect a telling process across passages, store an authored qualitative account with life_story_author_record kind assessment. Its optional data convention is {schema:"meaning-model-document-process/v1",documentId:storyRootId,label,question,summary,states:[{label,spanId,description,evidence:[{nodeId,excerpt}]}]}. Choose your own process labels and meaningful phases, using existing document.span IDs and exact quotations inside those spans. The tool records explicit about-links and the reviewed passage identities; the viewer shows these phases under Reading position → Story processes. Create a span through ordinary narrative records when a useful extent has none. Reading position is this document's ordered text, not elapsed world time, the author's life, or the authoring_step clock. The phase boundaries follow their passages as text length changes. Qualitative states need no numeric tension score. If numbers serve a specific question, declare whose judgment they are, comparison anchors, units and uncertainty through the existing numerical grammar; do not imply measured reader psychology or invent a generating law.
After splitting, merging, moving or changing a passage, inspect the affected telling and disclosure plans against the new text and reading order. Parent connections may remain with the container; relink a narrower disclosure explicitly when it belongs to a child. Stable anchors follow text extents, but do not prove the revised prose still has the same effect. A changed phase is marked for review; record a fresh assessment linked with supersedes when it replaces an earlier one. Investigate new questions recursively, including promising discoveries without a defect; these questions are starting points, not an exhaustive recipe.`;

const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

export async function disclosureReviewContext(view, passageIds, { service, input, nativeRendered }) {
  const nodes = new Map(view.nodes.filter((node) => !node.boundary && node.content_included !== false).map((node) => [node.id, node]));
  const parents = new Map();
  const links = new Map();
  const children = new Map(), next = new Map();
  const superseded = new Set();
  const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const edge of view.edges ?? []) {
    if (edge.source.kind !== 'node' || edge.target.kind !== 'node') continue;
    const source = edge.source.node_id, target = edge.target.node_id;
    if (!nodes.has(source) || !nodes.has(target)) continue;
    if (edge.relation === 'supersedes') superseded.add(target);
    if (edge.family === 'structural' && edge.relation === 'contains') {
      add(parents, target, { id: source, edge });
      add(children, source, { id: target, edge });
    }
    if (edge.family === 'structural' && edge.relation === 'next') add(next, source, { id: target, edge });
    // Author records automatically belong to their story. Membership is not an
    // authored claim that this particular plan covers every passage in the book.
    if (edge.id === `${source}.story` && nodes.get(source).node_type === 'storytelling.disclosure'
      && nodes.get(source).subject === target) continue;
    if (['semantic', 'grounding', 'provenance'].includes(edge.family) && edge.relation !== 'supersedes') {
      add(links, source, { id: target, edge }); add(links, target, { id: source, edge });
    }
  }
  const scopes = new Map(passageIds.map((id) => {
    const seen = new Set(), pending = [id];
    while (pending.length) {
      const next = pending.pop();
      if (seen.has(next)) continue;
      seen.add(next); pending.push(...(parents.get(next) ?? []).map(({ id }) => id));
    }
    return [id, seen];
  }));
  // A visible edge may be narrower than both endpoints. The derived association
  // must retain that audience, including the containment/order paths it uses.
  // Return deduplicated audiences, not a second copy of the source graph.
  const evidenceAudiences = new Map();
  const recordEvidence = (record) => {
    const audience = [...new Set(record?.access_scopes ?? [])].sort();
    if (audience.length) evidenceAudiences.set(JSON.stringify(audience), audience);
  };
  const pathFinder = (outgoing) => {
    const cache = new Map();
    return (from, to) => {
      const key = JSON.stringify([from, to]);
      if (cache.has(key)) return cache.get(key);
      if (from === to) return new Set();
      const seen = new Set([from]), pending = [from], incoming = new Map();
      for (let i = 0; i < pending.length; i++) for (const link of outgoing(pending[i])) {
        add(incoming, link.id, { id: pending[i], edge: link.edge });
        if (!seen.has(link.id)) { seen.add(link.id); pending.push(link.id); }
      }
      if (!seen.has(to)) { cache.set(key, null); return null; }
      const edges = new Set(), ancestors = [to], visited = new Set([to]);
      for (let i = 0; i < ancestors.length; i++) for (const link of incoming.get(ancestors[i]) ?? []) {
        edges.add(link.edge);
        if (!visited.has(link.id)) { visited.add(link.id); ancestors.push(link.id); }
      }
      cache.set(key, edges); return edges;
    };
  };
  const ancestorPath = pathFinder((id) => parents.get(id) ?? []);
  // Match native projection traversal: contains takes precedence over next.
  const documentPath = pathFinder((id) => children.get(id) ?? next.get(id) ?? []);
  const recordPath = (edges) => {
    for (const edge of edges ?? []) {
      recordEvidence(edge);
      recordEvidence(nodes.get(edge.source.node_id)); recordEvidence(nodes.get(edge.target.node_id));
    }
  };
  const projections = new Map(), unresolvedSpans = new Map(), plans = [];
  for (const node of nodes.values()) {
    if (superseded.has(node.id) || node.node_type !== 'storytelling.disclosure') continue;
    const connections = links.get(node.id) ?? [];
    const targets = new Set(connections.map(({ id }) => id));
    const directPassages = [...scopes].filter(([, scope]) => [...targets].some((id) => scope.has(id))).map(([id]) => id);
    for (const passageId of directPassages) for (const link of connections) {
      const edges = ancestorPath(passageId, link.id);
      if (edges === null) continue;
      recordEvidence(link.edge); recordEvidence(nodes.get(link.id)); recordPath(edges);
    }
    const spanRecords = [];
    const spanPassages = new Set();
    // Resolve the actual native document projection, including the interior of
    // spans and the current descendants of split passages. Endpoints alone do
    // not establish that a reviewed passage falls inside the declared interval.
    for (const link of connections) {
      const id = link.id;
      const spanNode = nodes.get(id);
      if (spanNode?.node_type !== 'document.span') continue;
      const parsed = documentSpanSchema.safeParse(parse(spanNode.text));
      const relevantDocumentPaths = parsed.success
        ? passageIds.map((passageId) => documentPath(parsed.data.documentId, passageId)).filter((edges) => edges !== null) : [];
      const unresolved = (reason) => {
        // Do not report another document's broken private span in this review.
        if (!directPassages.length && !relevantDocumentPaths.length) return;
        unresolvedSpans.set(id, { nodeId: id, reason });
        recordEvidence(node); recordEvidence(spanNode); recordEvidence(link.edge);
        relevantDocumentPaths.forEach(recordPath);
      };
      if (!parsed.success || !nodes.has(parsed.data.documentId)) {
        unresolved(parsed.success ? 'document_not_visible' : 'invalid_span_record');
        continue;
      }
      const rootId = parsed.data.documentId;
      if (!projections.has(rootId)) {
        const rendered = nativeRendered.roots?.length === 1 && nativeRendered.roots[0] === rootId
          ? nativeRendered : await service.renderNarrativeGraph({ graphHash: input.graphHash,
            expectedGraphHash: input.graphHash, rootIds: [rootId], accessScopes: input.accessScopes });
        if (rendered.graph_hash !== view.graph_hash || rendered.source_snapshot_hash !== view.source_snapshot_hash) {
          throw new Error('Disclosure span review requires the exact graph revision and source.');
        }
        projections.set(rootId, projectDocument({ rendered, nodes: view.nodes, edges: view.edges, rootId }));
      }
      const projection = projections.get(rootId);
      const span = projection.spans.find((candidate) => candidate.nodeId === id);
      if (span?.status !== 'resolved') {
        unresolved(span?.reason ?? 'span_not_visible');
        continue;
      }
      const covered = projection.units.filter((unit) => unit.length > 0 && unit.start < span.end && unit.end > span.start);
      const selected = covered.filter((unit) => scopes.has(unit.nodeId));
      if (selected.length) {
        selected.forEach((unit) => spanPassages.add(unit.nodeId));
        if (!spanRecords.some((record) => record.id === id)) spanRecords.push(structuredClone(spanNode));
        recordEvidence(link.edge); recordEvidence(spanNode); recordEvidence(nodes.get(rootId));
        const endpoints = [parsed.data.start.nodeId, parsed.data.end.nodeId];
        for (const endpoint of endpoints) {
          recordEvidence(nodes.get(endpoint)); recordPath(documentPath(rootId, endpoint));
          // Container boundaries depend on their current rendered descendants.
          for (const unit of projection.units) if (ancestorPath(unit.nodeId, endpoint) !== null) {
            recordPath(documentPath(rootId, unit.nodeId));
          }
        }
        selected.forEach((unit) => recordPath(documentPath(rootId, unit.nodeId)));
      }
    }
    const linkedPassageIds = passageIds.filter((id) => directPassages.includes(id) || spanPassages.has(id));
    if (linkedPassageIds.length) plans.push({ nodeId: node.id, linkedPassageIds, record: structuredClone(node), spanRecords });
  }
  const linked = new Set(plans.flatMap((plan) => plan.linkedPassageIds));
  return {
    plans,
    evidenceAccessScopes: [...evidenceAudiences.values()],
    unresolvedSpans: [...unresolvedSpans.values()],
    passageIdsWithoutLinkedPlan: passageIds.filter((id) => !linked.has(id)),
    scope: 'Visible direct links, containing passages, and resolved document spans; automatic story membership does not declare passage coverage. Unlinked or inaccessible plans are not assumed absent from the whole model.',
    completenessVerified: false,
    semanticDisclosureVerified: false,
    guidance: disclosureInstructions,
  };
}
