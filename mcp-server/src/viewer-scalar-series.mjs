// Project explicitly dated scalar records. These are attributed samples, not
// accepted runtime state, reconstructed measurements, or evaluated process laws.
import { isDeepStrictEqual } from 'node:util';

export function projectScalarSeries(model, { modelHash = null, graph = null, toDisplayTime = (value) => value,
  claimBorn = () => null, processBorn = () => null, nodeBorn = () => null, edgeBorn = () => null } = {}) {
  const copy = (value) => value === undefined ? null : structuredClone(value);
  const processes = new Map((model?.processes ?? []).map((process) => [process.id, process]));
  const groups = new Map();
  const latest = (...stamps) => stamps.filter(Boolean).sort((a, b) => (b.order ?? -1) - (a.order ?? -1))[0] ?? null;
  const add = (processId, sample, source) => {
    const process = processes.get(processId);
    const t = Number.isFinite(sample.valueTime) ? toDisplayTime(sample.valueTime) : null;
    if (!String(model?.time_unit ?? '').trim() || process?.value_type?.kind !== 'scalar'
      || !Number.isFinite(t) || !Number.isFinite(sample.v) || !Number.isFinite(sample.evidenceCutoff)) return;
    const identity = { processId, source, holder: sample.holder, mode: sample.mode, evidenceType: sample.evidenceType,
      authoritySource: sample.authority?.source ?? null, accessScopes: [...(sample.accessScopes ?? [])].sort() };
    const key = JSON.stringify(identity);
    if (!groups.has(key)) {
      const sourceEventIds = [...new Set((model.meaning_model?.events ?? []).filter((event) => event.process_ids?.includes(processId)).map((event) => event.id))];
      groups.set(key, { id: `typed-scalar:${encodeURIComponent(key)}`, kind: 'typed-scalar', processId,
        label: processId, unit: process.unit ?? null, frame: process.reference_frame ?? null,
        role: process.scale?.semantic_role ?? null, timeUnit: model.time_unit, source: copy(source),
        holder: sample.holder, mode: sample.mode, evidenceType: sample.evidenceType,
        sourceEventIds, home: sourceEventIds.length === 1 ? sourceEventIds[0] : null, points: [] });
    }
    groups.get(key).points.push(copy({ ...sample, t, born: latest(sample.born, processBorn(processId)) }));
  };
  for (const claim of model?.initial_claims ?? []) {
    if (claim.value?.kind !== 'scalar' || !Number.isFinite(claim.value_time)
      || claim.value_time > claim.evidence_cutoff || claim.evidence_cutoff > 0) continue;
    add(claim.subject, { id: claim.id, v: claim.value.value, valueTime: claim.value_time,
      evidenceCutoff: claim.evidence_cutoff, holder: claim.holder ?? null, mode: claim.mode ?? null,
      evidenceType: claim.evidence_type ?? null, authority: copy(claim.authority), uncertainty: copy(claim.uncertainty),
      provenance: copy(claim.provenance ?? []), accessScopes: copy(claim.access_scopes ?? []),
      born: copy(claimBorn(claim.id)), record: copy(claim), reviewStatus: null, acceptedWorldValue: false,
    }, { kind: 'initial-claims', modelHash });
  }

  // Read only the supplied exact graph. A record must belong to one explicit
  // estimation bundle and one process anchor; IDs or prose never imply either.
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const parents = new Map(), anchors = new Map();
  const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const edge of graph?.edges ?? []) {
    if (edge.family === 'structural' && edge.relation === 'contains' && edge.source?.kind === 'node' && edge.target?.kind === 'node') {
      if (nodes.get(edge.source.node_id)?.node_type === 'process_estimation_bundle') push(parents, edge.target.node_id, edge);
    }
    if (edge.family === 'grounding' && edge.relation === 'about' && edge.source?.kind === 'node'
      && edge.target?.kind === 'anchor' && edge.target.anchor_kind === 'process') push(anchors, edge.source.node_id, edge);
  }
  const payloads = new Map();
  const parse = (node) => {
    if (!payloads.has(node.id)) {
      try { const value = JSON.parse(node.text); payloads.set(node.id, value && typeof value === 'object' && !Array.isArray(value) ? value : null); }
      catch { payloads.set(node.id, null); }
    }
    return payloads.get(node.id);
  };
  for (const node of nodes.values()) {
    if (node.node_type !== 'process_estimate') continue;
    const output = parse(node), placement = parents.get(node.id) ?? [], grounding = anchors.get(node.id) ?? [];
    if (!output || placement.length !== 1 || grounding.length !== 1 || output.status !== 'known'
      || output.reviewStatus !== 'approved' || output.acceptedWorldValue !== false || output.value?.kind !== 'scalar'
      || output.processId !== grounding[0].target.anchor_id || output.valueTime !== node.value_time
      || output.evidenceCutoff !== node.evidence_cutoff) continue;
    const bundleNode = nodes.get(placement[0].source.node_id), bundle = parse(bundleNode);
    if (!bundle || bundle.schema !== 'meaning-model-process-estimation/v1' || bundle.reviewedDisposition !== 'approved'
      || bundle.review?.verdict !== 'approved' || bundle.request?.modelHash !== modelHash || !modelHash
      || !bundle.request.estimationRequestId || !Array.isArray(bundle.request.coordinates)) continue;
    const coordinates = bundle.request.coordinates.filter((coordinate) => coordinate.id === output.coordinateId);
    if (coordinates.length !== 1 || coordinates[0].processId !== output.processId
      || (coordinates[0].targetTime ?? bundle.request.acceptedHeadTime) !== output.valueTime
      || (output.unit !== undefined && output.unit !== processes.get(output.processId)?.unit)) continue;
    const reviewed = Array.isArray(bundle.mapped) ? bundle.mapped.filter((entry) => entry.coordinateId === output.coordinateId) : [];
    if (reviewed.length !== 1) continue;
    const cutoff = bundle.source === 'estimation_exchange_proposal' && reviewed[0].evidenceType
      ? reviewed[0].claimEvidenceCutoff : bundle.request.evidenceCutoff;
    // The child copies a reviewed output. A later edit to only that child must
    // not inherit the approval of different values still held by its bundle.
    if (!isDeepStrictEqual(output, { ...reviewed[0], reviewStatus: bundle.reviewedDisposition, acceptedWorldValue: false,
      evidenceCutoff: cutoff, valueTime: coordinates[0].targetTime ?? bundle.request.acceptedHeadTime })) continue;
    const holder = output.holder ?? node.holder ?? bundle.provider ?? null;
    add(output.processId, { id: node.id, v: output.value.value, valueTime: node.value_time,
      evidenceCutoff: node.evidence_cutoff, holder, mode: output.outputMode ?? (bundle.provider ? 'estimated' : null),
      evidenceType: output.evidenceType ?? node.evidence_type ?? null, authority: copy(output.authority ?? node.authority),
      uncertainty: copy(output.uncertainty ?? node.uncertainty),
      provenance: copy(output.provenance ?? node.provenance ?? []), accessScopes: copy(node.access_scopes ?? []),
      born: copy(latest(nodeBorn(node.id), nodeBorn(bundleNode.id), edgeBorn(placement[0].id), edgeBorn(grounding[0].id))),
      record: copy(node), output: copy(output), reviewStatus: output.reviewStatus,
      review: copy(bundle.review), acceptedWorldValue: false,
    }, { kind: 'process-estimation', modelHash, bundleNodeId: bundleNode.id,
      estimationRequestId: bundle.request.estimationRequestId, proposalId: bundle.proposal?.proposalId ?? null });
  }
  return [...groups.values()].map((series) => {
    series.points.sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
    const byTime = new Map();
    for (const point of series.points) push(byTime, point.t, point.id);
    const conflicts = [...byTime].filter(([, ids]) => ids.length > 1).map(([t, recordIds]) => ({ t, recordIds }));
    return { ...series, domain: [series.points[0].t, series.points.at(-1).t], conflicts,
      interpolation: { kind: series.points.length >= 2 && !conflicts.length ? 'linear-visual-guide' : 'none', extrapolate: false } };
  }).sort((a, b) => a.id.localeCompare(b.id));
}
