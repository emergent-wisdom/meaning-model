// Native records and declared references only. The layout below is presentation,
// never a clock, trajectory, causal inference, or implicit single-root hierarchy.
const array = (value) => Array.isArray(value) ? value : [];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const modelGraphId = (kind, id) => JSON.stringify([kind, String(id)]);
const pointerToken = (value) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');

function pointerExists(record, path) {
  if (path == null || path === '') return true;
  if (!path.startsWith('/')) return false;
  let value = record;
  for (const token of path.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(token)) return false;
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) return false;
    if (value == null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = value[key];
  }
  return true;
}

/** Project one access-checked native snapshot; records are retained by reference. */
export function buildModelGraph(inspection = {}) {
  const model = inspection.model ?? {}, graph = inspection.graph ?? {}, meaning = model.meaning_model ?? {};
  const nodes = new Map(), edges = [], edgeIds = new Set(), timeUnit = model.time_unit ?? null;
  const roots = new Map();
  for (const context of array(meaning.context_roots)) {
    if (!roots.has(context.event_id)) roots.set(context.event_id, []);
    roots.get(context.event_id).push(context);
  }
  const addNode = (kind, nativeId, record, path = null, extra = {}) => {
    const id = modelGraphId(kind, nativeId);
    if (!nodes.has(id)) nodes.set(id, { id, nativeId: String(nativeId), kind,
      label: String(record?.title ?? record?.label ?? record?.question ?? record?.boundary ?? record?.key ?? nativeId),
      record, path, interval: record?.interval ?? null, timeUnit, withdrawn: record?.withdrawn ?? null,
      // Only directly declared context roots are attached here. Containment edges
      // retain all parents; no first-parent choice assigns an implicit context.
      contexts: kind === 'event' ? roots.get(nativeId) ?? [] : [],
      context: { holder: record?.holder ?? null, subject: record?.subject ?? null,
        participants: record?.participants ?? null, substrate: record?.substrate ?? null,
        region: record?.region ?? null, valueTime: record?.value_time ?? null,
        evidenceCutoff: record?.evidence_cutoff ?? null },
      unresolved: false, ...extra });
    return id;
  };
  const resolve = (kind, nativeId) => {
    const id = modelGraphId(kind, nativeId);
    if (!nodes.has(id)) addNode(kind, nativeId, null, null, { unresolved: true,
      label: `Unresolved ${kind}: ${nativeId}`, reason: 'Referenced record is absent from this snapshot.' });
    return id;
  };
  const edge = (source, target, kind, relation, record, path, extra = {}) => {
    const id = JSON.stringify([kind, path, source, target]);
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, source, target, kind, relation, record, path, ...extra });
  };
  const link = (ownerKind, owner, targetKind, targetId, relation, path, extra = {}) => {
    if (targetId == null) return;
    edge(resolve(ownerKind, owner.id), resolve(targetKind, targetId), 'reference', relation, owner, path, extra);
  };
  const collections = [
    ['process', model.processes, '/processes'], ['law', model.laws, '/laws'],
    ['claim', model.initial_claims, '/initial_claims'],
    ['decomposition', model.decomposition, '/decomposition'], ['dependency', model.dependencies, '/dependencies'],
    ['concept', meaning.concepts, '/meaning_model/concepts'],
    ['abstract_relation', meaning.abstract_relations, '/meaning_model/abstract_relations'],
    ['abstract_cut', meaning.abstract_cuts, '/meaning_model/abstract_cuts'],
    ['referent', meaning.referents, '/meaning_model/referents'],
    ['encapsulation_cut', meaning.encapsulation_cuts, '/meaning_model/encapsulation_cuts'],
    ['event', meaning.events, '/meaning_model/events'],
    ['event_relation', meaning.event_relations, '/meaning_model/event_relations'],
    ['event_referent_binding', meaning.event_referent_bindings, '/meaning_model/event_referent_bindings'],
    ['physical_cut', meaning.physical_cuts, '/meaning_model/physical_cuts'],
    ['realization', meaning.realizations, '/meaning_model/realizations'],
    ['normalized_cut', meaning.normalized_cuts, '/meaning_model/normalized_cuts'],
    ['narrative', graph.nodes, '/graph/nodes'],
  ];
  if (model.id != null) addNode('model', model.id, model, '/');
  for (const [kind, records, path] of collections) array(records).forEach((record, i) => {
    if (record?.id != null) addNode(kind, record.id, record, `${path}/${i}`);
  });
  for (const eventId of roots.keys()) resolve('event', eventId);
  const each = (items, base, callback) => array(items).forEach((record, i) => callback(record, `${base}/${i}`));
  const direct = (kind, record, sourceKind, sourceId, targetKind, targetId, relation, path, sourceField, targetField) => {
    const source = resolve(sourceKind, sourceId), target = resolve(targetKind, targetId);
    edge(source, target, kind, relation, record, path);
    // Reified relation records can themselves be anchored. Their endpoint links
    // are visibly metadata, not extra claims of containment or causation.
    const recordId = resolve(kind, record.id);
    edge(recordId, source, 'record_endpoint', 'source', record, `${path}/${sourceField}`);
    edge(recordId, target, 'record_endpoint', 'target', record, `${path}/${targetField}`);
  };
  each(model.decomposition, '/decomposition', (record, path) =>
    direct('decomposition', record, 'process', record.parent, 'process', record.child, record.kind, path, 'parent', 'child'));
  each(model.dependencies, '/dependencies', (record, path) => {
    direct('dependency', record, 'process', record.source, 'process', record.target, record.kind, path, 'source', 'target');
    link('dependency', record, 'law', record.law_id, 'law', `${path}/law_id`);
  });
  each(meaning.abstract_relations, '/meaning_model/abstract_relations', (record, path) =>
    direct('abstract_relation', record, 'concept', record.source_concept_id, 'concept', record.target_concept_id, record.kind, path, 'source_concept_id', 'target_concept_id'));
  each(meaning.event_relations, '/meaning_model/event_relations', (record, path) => {
    direct('event_relation', record, 'event', record.source_event_id, 'event', record.target_event_id, record.kind, path, 'source_event_id', 'target_event_id');
  });
  each(meaning.events, '/meaning_model/events', (record, path) => {
    array(record.process_ids).forEach((id, i) => link('event', record, 'process', id, 'process', `${path}/process_ids/${i}`));
    array(record.observation_process_ids).forEach((id, i) => link('event', record, 'process', id, 'observation_process', `${path}/observation_process_ids/${i}`));
    // participants/substrate/region are legacy free-text annotations, not typed
    // referent links. Only event_referent_bindings below establish that bridge.
  });
  each(meaning.referents, '/meaning_model/referents', (record, path) =>
    link('referent', record, 'event', record.lifecycle_event_id, 'lifecycle', `${path}/lifecycle_event_id`));
  each(meaning.event_referent_bindings, '/meaning_model/event_referent_bindings', (record, path) => {
    const targetKind = record.target?.kind;
    const targetId = targetKind === 'event' ? record.target.event_id : record.target?.process_id;
    if (targetKind === 'event' || targetKind === 'process') {
      direct('event_referent_binding', record, targetKind, targetId, 'referent', record.referent_id, record.binding_type, path, `target/${targetKind}_id`, 'referent_id');
    }
  });
  for (const [kind, records, parentKind, parentKey, childKey] of [
    ['abstract_cut', meaning.abstract_cuts, 'concept', 'parent_concept_id', 'child_concept_ids'],
    ['physical_cut', meaning.physical_cuts, 'event', 'parent_event_id', 'child_event_ids'],
  ]) each(records, `/meaning_model/${kind}s`, (record, path) => {
    edge(resolve(parentKind, record[parentKey]), resolve(kind, record.id), 'reference', 'cut', record, `${path}/${parentKey}`);
    array(record[childKey]).forEach((id, i) => link(kind, record, parentKind, id, 'cut_child', `${path}/${childKey}/${i}`));
  });
  each(meaning.encapsulation_cuts, '/meaning_model/encapsulation_cuts', (record, path) => {
    edge(resolve('referent', record.parent_referent_id), resolve('encapsulation_cut', record.id), 'reference', 'encapsulation_cut', record, `${path}/parent_referent_id`);
    array(record.children).forEach((child, i) => link('encapsulation_cut', record, 'referent', child.referent_id, child.relation, `${path}/children/${i}`, { childRecord: child }));
  });
  each(meaning.realizations, '/meaning_model/realizations', (record, path) => {
    link('realization', record, 'concept', record.concept_id, 'realizes_concept', `${path}/concept_id`);
    link('realization', record, 'abstract_cut', record.abstract_cut_id, 'abstract_cut', `${path}/abstract_cut_id`);
    link('realization', record, 'physical_cut', record.physical_cut_id, 'physical_cut', `${path}/physical_cut_id`);
    for (const [field, kind] of [['roles', 'event'], ['referent_roles', 'referent']]) {
      for (const [role, id] of Object.entries(record[field] ?? {})) link('realization', record, kind, id, role, `${path}/${field}/${pointerToken(role)}`, { role });
    }
  });
  const answerId = (cutId, key) => modelGraphId('normalized_cut_answer', JSON.stringify([cutId, key]));
  each(meaning.normalized_cuts, '/meaning_model/normalized_cuts', (record, path) => {
    edge(resolve('event', record.parent_event_id), resolve('normalized_cut', record.id), 'reference', 'cut', record, `${path}/parent_event_id`);
    array(record.answers).forEach((answer, i) => {
      const id = addNode('normalized_cut_answer', JSON.stringify([record.id, answer.key]), answer, `${path}/answers/${i}`,
        { cutId: record.id, answerKey: answer.key, withdrawn: record.withdrawn ?? null });
      edge(resolve('normalized_cut', record.id), id, 'reference', 'answer', answer, `${path}/answers/${i}`);
    });
  });
  const resolveAnswer = (condition) => {
    const id = answerId(condition.cut_id, condition.answer_key);
    return nodes.has(id) ? id : resolve('normalized_cut_answer', JSON.stringify([condition.cut_id, condition.answer_key]));
  };
  each(meaning.normalized_cuts, '/meaning_model/normalized_cuts', (record, path) => {
    if (record.conditioning) edge(resolveAnswer(record.conditioning), resolve('normalized_cut', record.id), 'reference', 'conditions', record, `${path}/conditioning`);
    array(record.withdrawn?.superseded_by).forEach((id, i) => link('normalized_cut', record, 'normalized_cut', id, 'superseded_by', `${path}/withdrawn/superseded_by/${i}`));
  });
  each(meaning.event_relations, '/meaning_model/event_relations', (record, path) => {
    if (record.forecast_answer) edge(resolve('event_relation', record.id), resolveAnswer(record.forecast_answer), 'reference', 'forecast_answer', record, `${path}/forecast_answer`);
  });
  for (const [kind, records] of [['concept', meaning.concepts], ['abstract_cut', meaning.abstract_cuts]]) {
    each(records, `/meaning_model/${kind}s`, (record, path) => array(record.withdrawn?.superseded_by).forEach((id, i) =>
      link(kind, record, kind, id, 'superseded_by', `${path}/withdrawn/superseded_by/${i}`)));
  }
  each(meaning.temporal_cut_recompositions, '/meaning_model/temporal_cut_recompositions', (record, path) => {
    array(record.children).forEach((child, i) => edge(resolve('normalized_cut', record.parent_cut_id), resolve('normalized_cut', child.cut_id),
      'temporal_cut_recomposition', child.projection?.kind ?? 'projection', record, `${path}/children/${i}`,
      { coverage: record.coverage, projection: child.projection }));
  });
  each(model.initial_claims, '/initial_claims', (record, path) => link('claim', record, 'process', record.subject, 'subject', `${path}/subject`));
  each(model.laws, '/laws', (record, path) => {
    const operator = record.operator ?? {}, base = `${path}/operator`;
    link('law', record, 'process', operator.target, 'target', `${base}/target`);
    array(operator.effects).forEach((effect, i) => link('law', record, 'process', effect.target, 'effect', `${base}/effects/${i}/target`));
    array(operator.activates).forEach((id, i) => link('law', record, 'law', id, 'activates', `${base}/activates/${i}`));
    if (operator.role === 'epistemic') link('law', record, 'process', operator.claim?.subject, 'claim_subject', `${base}/claim/subject`);
    // Walk the native operator, but recognize only the typed scalar-expression
    // variant. Free text/support/provenance containing IDs never creates edges.
    const pending = [[operator, base]];
    while (pending.length) {
      const [value, at] = pending.pop();
      if (!value || typeof value !== 'object') continue;
      if (value.op === 'process' && typeof value.process === 'string') link('law', record, 'process', value.process, 'reads', `${at}/process`);
      for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') pending.push([child, `${at}/${pointerToken(key)}`]);
    }
  });
  const anchor = (endpoint) => {
    if (endpoint?.kind === 'node') return resolve('narrative', endpoint.node_id);
    if (endpoint?.kind !== 'anchor') return resolve('unknown_endpoint', JSON.stringify(endpoint));
    const kind = endpoint.anchor_kind, nativeId = endpoint.anchor_id;
    const modelHash = inspection.modelHash ?? graph.source?.model_hash;
    const targetId = kind === 'model' && modelHash != null && nativeId === modelHash && model.id != null
      ? modelGraphId('model', model.id) : modelGraphId(kind, nativeId);
    const target = nodes.get(targetId);
    if (target && !target.unresolved && pointerExists(target.record, endpoint.path)) {
      // Answer addresses remain distinct from their owning Cut. Preserve the
      // original native pointer on the narrative edge, including deeper paths.
      if (kind === 'normalized_cut' && /^\/answers\/(0|[1-9]\d*)(?:\/|$)/.test(endpoint.path ?? '')) {
        const answer = target.record.answers[Number(endpoint.path.split('/')[2])];
        if (answer) return answerId(nativeId, answer.key);
      }
      return targetId;
    }
    if (!endpoint.path) return resolve(kind, nativeId);
    return addNode('unresolved_anchor', JSON.stringify([kind, nativeId, endpoint.path]), null, null,
      { unresolved: true, anchor: endpoint, label: `Unresolved ${kind}: ${nativeId}${endpoint.path}`,
        reason: target && !target.unresolved ? 'Anchor path is absent from the referenced record.' : 'Referenced record is absent from this snapshot.' });
  };
  each(graph.edges, '/graph/edges', (record, path) => edge(anchor(record.source), anchor(record.target), 'narrative_edge', record.relation, record, path,
    { family: record.family, sourcePath: record.source?.path ?? null, targetPath: record.target?.path ?? null }));

  const nodeList = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  edges.sort((a, b) => compare(a.id, b.id));
  const byKind = {}, edgesByKind = {};
  for (const node of nodeList) byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
  for (const item of edges) edgesByKind[item.kind] = (edgesByKind[item.kind] ?? 0) + 1;
  const unresolved = nodeList.filter((node) => node.unresolved).length;
  const relationshipKinds = new Set(['decomposition', 'dependency', 'abstract_relation', 'event_relation', 'event_referent_binding']);
  const relationshipRecords = nodeList.filter((node) => !node.unresolved && relationshipKinds.has(node.kind)).length;
  return { nodes: nodeList, edges, counts: { nodes: nodeList.length, edges: edges.length,
    records: nodeList.length - unresolved, unresolved, byKind, edgesByKind,
    relationshipRecords, answerRecords: nodeList.filter((node) => !node.unresolved && node.kind === 'normalized_cut_answer').length,
    recordEndpointEdges: edgesByKind.record_endpoint ?? 0 } };
}

/** Stable topology-aware positions, bounded in a sphere of radius. O(V + E) per
 * pass; no pairwise force simulation, random source, time conversion or sampling. */
export function layoutModelGraph(graph, { radius = 120, iterations = 24 } = {}) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Layout radius must be positive and finite.');
  if (!Number.isInteger(iterations) || iterations < 0 || iterations > 100) throw new Error('Layout iterations must be between 0 and 100.');
  const nodes = [...array(graph?.nodes)].sort((a, b) => compare(a.id, b.id));
  const ids = new Map(nodes.map((node, i) => [node.id, i])), neighbours = nodes.map(() => new Set());
  for (const edge of array(graph?.edges)) {
    const a = ids.get(edge.source), b = ids.get(edge.target);
    if (a == null || b == null || a === b) continue;
    neighbours[a].add(b); neighbours[b].add(a);
  }
  const adjacency = neighbours.map((items) => [...items].sort((a, b) => a - b));
  const seen = new Set(), components = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (seen.has(i)) continue;
    const group = [], pending = [i]; seen.add(i);
    while (pending.length) {
      const next = pending.pop(); group.push(next);
      for (const neighbour of adjacency[next]) if (!seen.has(neighbour)) { seen.add(neighbour); pending.push(neighbour); }
    }
    group.sort((a, b) => a - b); components.push(group);
  }
  components.sort((a, b) => b.length - a.length || a[0] - b[0]);
  const sphere = (i, n, size) => {
    if (n === 1) return { x: 0, y: 0, z: 0 };
    const y = 1 - 2 * (i + 0.5) / n, angle = i * Math.PI * (3 - Math.sqrt(5)), r = Math.sqrt(1 - y * y);
    return { x: size * r * Math.cos(angle), y: size * y, z: size * r * Math.sin(angle) };
  };
  // Allocate volume by component size, not one equal-radius slot per component.
  // The largest component stays central; a lone disconnected record cannot
  // push the entire connected model into a tiny satellite-sized cluster.
  const anchors = new Array(nodes.length), positions = new Array(nodes.length), placements = [];
  const cells = new Map(), cursors = new Map(), gap = 0.15, cellSize = 2;
  const cellKeys = (center, size, visit) => {
    for (let x = Math.floor((center.x - size) / cellSize); x <= Math.floor((center.x + size) / cellSize); x += 1) {
      for (let y = Math.floor((center.y - size) / cellSize); y <= Math.floor((center.y + size) / cellSize); y += 1) {
        for (let z = Math.floor((center.z - size) / cellSize); z <= Math.floor((center.z + size) / cellSize); z += 1) visit(`${x},${y},${z}`);
      }
    }
  };
  const fits = (center, size) => {
    const candidates = new Set();
    cellKeys(center, size + gap / 2, (key) => { for (const index of cells.get(key) ?? []) candidates.add(index); });
    for (const index of candidates) {
      const placed = placements[index], distance = size + placed.size + gap;
      if ((center.x - placed.center.x) ** 2 + (center.y - placed.center.y) ** 2 + (center.z - placed.center.z) ** 2 < distance ** 2) return false;
    }
    return true;
  };
  components.forEach((group, c) => {
    const size = Math.cbrt(group.length);
    let center = { x: 0, y: 0, z: 0 };
    if (c) {
      // Equal-size groups resume after the last tested slot. Occupied slots
      // cannot become free later, so this avoids rescanning earlier components.
      const cursor = cursors.get(group.length) ?? { shell: 0, slot: 0 };
      do {
        const distance = placements[0].size + size + gap + cursor.shell * (2 * size + gap);
        const slots = Math.max(12, Math.floor(2 * (distance / (size + gap)) ** 2));
        center = sphere(cursor.slot, slots, distance);
        cursor.slot += 1;
        if (cursor.slot === slots) { cursor.shell += 1; cursor.slot = 0; }
      } while (!fits(center, size));
      cursors.set(group.length, cursor);
    }
    placements.push({ center, size });
    cellKeys(center, size + gap / 2, (key) => {
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(c);
    });
    group.forEach((index, i) => {
      const offset = sphere(i, group.length, size);
      anchors[index] = { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z };
      positions[index] = { ...anchors[index] };
    });
  });
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = positions.map((position, i) => {
      if (!adjacency[i].length) return position;
      const sum = { x: 0, y: 0, z: 0 };
      for (const j of adjacency[i]) { sum.x += positions[j].x; sum.y += positions[j].y; sum.z += positions[j].z; }
      const weight = 0.3 / adjacency[i].length;
      return { x: 0.7 * anchors[i].x + weight * sum.x, y: 0.7 * anchors[i].y + weight * sum.y, z: 0.7 * anchors[i].z + weight * sum.z };
    });
    for (let i = 0; i < next.length; i += 1) positions[i] = next[i];
  }
  // Smoothing affects shape only. Restore the allocated component extent, then
  // fit all actual points to the requested bound without discarding outliers.
  components.forEach((group, c) => {
    if (group.length === 1) return;
    const { center, size } = placements[c];
    let extent = 0;
    for (const i of group) extent = Math.max(extent, Math.hypot(positions[i].x - center.x, positions[i].y - center.y, positions[i].z - center.z));
    if (!extent) return;
    for (const i of group) {
      const point = positions[i];
      positions[i] = { x: center.x + (point.x - center.x) * size / extent,
        y: center.y + (point.y - center.y) * size / extent, z: center.z + (point.z - center.z) * size / extent };
    }
  });
  let extent = 0;
  for (const point of positions) extent = Math.max(extent, Math.hypot(point.x, point.y, point.z));
  const scale = extent ? radius / extent : 1;
  for (const point of positions) { point.x *= scale; point.y *= scale; point.z *= scale; }
  return new Map(nodes.map((node, i) => [node.id, positions[i]]));
}
