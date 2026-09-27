// The common 3D view uses the native graph, independent of trajectories, story,
// clock, or subject matter. Spatial coordinates are presentation only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildModelGraph, overviewModelGraph, layoutModelGraph } from './model-graph.js';
import { formatModelInterval } from './structure-model.js';
import { proseUnit } from './inspector.js';

const COLORS = { event: '#9fc3ff', process: '#93d3bd', referent: '#dca4bd', concept: '#c9b4f4',
  normalized_cut: '#e5bd7b', normalized_cut_answer: '#c39c68', physical_cut: '#db9d78', narrative: '#fff3dc',
  event_relation: '#858e9e', decomposition: '#9db9c2', dependency: '#a9afbb', model: '#f2f1ec' };
const words = (value) => String(value).replace(/_/g, ' ');
const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text);
  if (className) node.className = className; return node;
};
const colorOf = (node) => node.unresolved ? '#ff6a7c' : COLORS[node.kind] ?? '#aaa5ca';

export function showGraph(data, { host, tools, detail, reader, surface, onSelect = () => {} }) {
  if (!data.inspection?.model) throw new Error('This snapshot lacks native graph records. Reopen it from the current MCP.');
  // The overview draws a Cut's answers within the Cut and the Cut within its Event, and a relation record as its link;
  // every record is one choice away. Each has its own layout, made when first shown.
  const graphs = { all: buildModelGraph(data.inspection) }; graphs.overview = overviewModelGraph(graphs.all);
  const layouts = new Map(), heldBy = new Map();
  for (const node of graphs.overview.nodes) for (const held of node.holds ?? []) heldBy.set(held.id, node.id);
  let mode = 'overview', graph = null, positions = null, nodeById = null, incident = null;
  function useGraph(next) {
    mode = next; graph = graphs[next];
    if (!layouts.has(next)) layouts.set(next, layoutModelGraph(graph));
    positions = layouts.get(next);
    nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    incident = new Map(graph.nodes.map((node) => [node.id, []]));
    for (const edge of graph.edges) {
      incident.get(edge.source)?.push(edge);
      if (edge.source !== edge.target) incident.get(edge.target)?.push(edge);
    }
  }
  useGraph('overview');
  // Fail before attaching controls or styles if this browser cannot create 3D.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const css = element('link'); css.rel = 'stylesheet'; css.href = 'graph-view.css'; document.head.append(css);
  const body = detail.querySelector('.details-body');
  const abort = new AbortController(); let active = false, alive = true, frameId = null;
  let selected = null, neighborsOnly = false, visibleNodes = [], visibleEdges = [], showEdges = true, rotating = false;
  let mesh = null, lines = null, selectedLines = null, visibleIndex = [], labelItems = [], dirty = true;
  const button = (label, action, parent = tools) => { const node = element('button', label, 'tool'); node.type = 'button'; node.addEventListener('click', action); parent.append(node); return node; };
  const spinButton = button('Rotate', () => { rotating = !rotating; controls.autoRotate = rotating; spinButton.setAttribute('aria-pressed', String(rotating)); });
  spinButton.setAttribute('aria-pressed', 'false');
  const edgesButton = button('Links', () => { showEdges = !showEdges; edgesButton.setAttribute('aria-pressed', String(showEdges)); refresh(); });
  edgesButton.setAttribute('aria-pressed', 'true');
  const everyButton = button('Every record', () => showRecords(mode === 'overview' ? 'all' : 'overview'));
  everyButton.setAttribute('aria-pressed', 'false');
  everyButton.title = 'Show each Cut answer, Cut and relation record as its own record. The overview draws them within the Cut, the Event and the link they belong to.';
  const filter = element('select', null, 'graph-control graph-filter'); filter.setAttribute('aria-label', 'Record type');
  let kinds = [];
  function fillFilter() {
    kinds = [...new Set(graph.nodes.map((node) => node.kind))].sort(); const chosen = filter.value;
    const all = element('option', 'All record types'); all.value = ''; filter.replaceChildren(all);
    for (const kind of kinds) { const option = element('option', `${words(kind)} (${graph.nodes.filter((node) => node.kind === kind).length})`); option.value = kind; filter.append(option); }
    filter.value = kinds.includes(chosen) ? chosen : '';
  }
  fillFilter();
  tools.append(filter); filter.addEventListener('change', () => { neighborsOnly = false; refresh(); fit(); updateSearch(); });
  const neighborButton = button('Neighbors only', () => { if (!selected) return; neighborsOnly = !neighborsOnly; if (neighborsOnly) filter.value = ''; refresh(); fit(); });
  neighborButton.disabled = true; neighborButton.setAttribute('aria-pressed', 'false');
  button('Show all', () => { filter.value = ''; selected = null; onSelect(null); detail.hidden = true; neighborsOnly = false; search.value = ''; searchResults.hidden = true; refresh(); fit(); });
  const searchRow = element('form', null, 'graph-search'), search = element('input', null, 'graph-control');
  search.type = 'search'; search.placeholder = 'Find a record…'; search.setAttribute('aria-label', 'Find a graph record'); searchRow.append(search); tools.append(searchRow);
  const findButton = element('button', 'Find', 'tool'); findButton.type = 'submit'; searchRow.append(findButton);
  const searchResults = element('div', null, 'graph-results'); searchResults.hidden = true; searchResults.setAttribute('aria-label', 'Matching records'); tools.append(searchResults);
  search.addEventListener('input', updateSearch);
  searchRow.addEventListener('submit', (event) => { event.preventDefault(); updateSearch(); searchResults.querySelector('button')?.click(); });

  const summary = element('aside', null, 'graph-summary'); summary.id = 'graph-summary'; summary.setAttribute('aria-label', 'Graph overview');
  summary.dataset.modelHash = data.modelHash ?? ''; summary.dataset.graphHash = data.headGraphHash ?? '';
  const count = element('strong'), explanation = element('span', 'Arrows show link direction. Position is a layout, not time or a measured distance.');
  const hint = element('span', 'Drag to turn · scroll to zoom · click a record to inspect its connections');
  summary.append(count, explanation, hint);
  const key = element('div', null, 'graph-key');
  function fillKey() { key.replaceChildren(); for (const kind of kinds) { const item = element('span'), dot = element('i'); dot.style.background = COLORS[kind] ?? '#aaa5ca'; item.append(dot, document.createTextNode(words(kind))); key.append(item); } }
  fillKey();
  summary.append(key); surface.append(summary);
  const empty = element('p', '', 'graph-empty'); empty.hidden = true; surface.append(empty);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D Meaning Model graph');
  const labels = new CSS2DRenderer(); Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }); host.append(labels.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050608');
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.autoRotateSpeed = .25;
  controls.addEventListener('change', () => { dirty = true; });
  const group = new THREE.Group(); scene.add(group);
  const geometry = new THREE.IcosahedronGeometry(1, 1), material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const point = (id) => { const p = positions.get(id) ?? { x: 0, y: 0, z: 0 }; return new THREE.Vector3(p.x, p.y, p.z); };
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
    down = null; const rect = renderer.domElement.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = mesh && ray.intersectObject(mesh)[0]; if (hit?.instanceId != null) select(visibleIndex[hit.instanceId].id);
  });
  function disposeLines(object) { if (object) { group.remove(object); object.geometry.dispose(); object.material.dispose(); } }
  function edgeLines(edges, tint, opacity) {
    const coords = [];
    const segment = (a, b) => coords.push(...a.toArray(), ...b.toArray());
    for (const edge of edges) {
      const a = point(edge.source), b = point(edge.target);
      if (edge.source === edge.target) {
        let previous = a.clone();
        for (let i = 1; i <= 18; i++) { const angle = i / 18 * Math.PI * 2, next = a.clone().add(new THREE.Vector3(Math.sin(angle) * 3, 3 - Math.cos(angle) * 3, 0)); segment(previous, next); previous = next; }
        continue;
      }
      segment(a, b);
      const direction = b.clone().sub(a), length = direction.length(); if (length < .001) continue; direction.divideScalar(length);
      const side = new THREE.Vector3().crossVectors(direction, Math.abs(direction.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const tip = a.clone().lerp(b, .76), back = tip.clone().addScaledVector(direction, -Math.min(1.4, length * .15));
      segment(tip, back.clone().addScaledVector(side, .65)); segment(tip, back.clone().addScaledVector(side, -.65));
    }
    const buffer = new THREE.BufferGeometry(); buffer.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const result = new THREE.LineSegments(buffer, new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity, depthWrite: false })); group.add(result); return result;
  }
  function refresh() {
    dirty = true;
    document.body.classList.toggle('graph-selection', !detail.hidden);
    const neighbors = new Set(selected ? [selected, ...(incident.get(selected) ?? []).flatMap((edge) => [edge.source, edge.target])] : []);
    visibleNodes = graph.nodes.filter((node) => (!filter.value || node.kind === filter.value) && (!neighborsOnly || neighbors.has(node.id)));
    const ids = new Set(visibleNodes.map((node) => node.id));
    visibleEdges = graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geometry, material, visibleNodes.length); mesh.frustumCulled = false; visibleIndex = visibleNodes;
    for (const [i, node] of visibleNodes.entries()) {
      const focus = node.id === selected; scale.setScalar(focus ? 2.2 : 1.15);
      matrix.compose(point(node.id), quaternion, scale); mesh.setMatrixAt(i, matrix);
      const c = new THREE.Color(focus ? '#fff0b8' : colorOf(node)); if (selected && !neighbors.has(node.id)) c.multiplyScalar(.35); mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; group.add(mesh);
    disposeLines(lines); disposeLines(selectedLines);
    lines = edgeLines(showEdges ? visibleEdges.filter((edge) => edge.source !== selected && edge.target !== selected) : [], '#a3a4aa', selected ? .06 : .16);
    selectedLines = edgeLines(showEdges && selected ? visibleEdges.filter((edge) => edge.source === selected || edge.target === selected) : [], '#ffe6ae', .85);
    for (const item of labelItems) { group.remove(item.object); item.object.element.remove(); }
    labelItems = [];
    const labeled = visibleNodes.filter((node) => node.id === selected || (selected && neighbors.has(node.id)))
      .sort((a, b) => Number(b.id === selected) - Number(a.id === selected)).slice(0, 14);
    if (!selected) labeled.push(...visibleNodes.slice().sort((a, b) => (incident.get(b.id)?.length ?? 0) - (incident.get(a.id)?.length ?? 0)).slice(0, 8));
    for (const node of labeled) {
      const label = element('div', node.label, `graph-label${node.id === selected ? ' selected' : ''}`); label.title = node.nativeId;
      const object = new CSS2DObject(label); object.position.copy(point(node.id)).add(new THREE.Vector3(0, 2.3, 0)); group.add(object); labelItems.push({ object, id: node.id });
    }
    count.textContent = `${visibleNodes.length.toLocaleString()} / ${graph.nodes.length.toLocaleString()} records · ${showEdges ? visibleEdges.length.toLocaleString() : '0'} / ${graph.edges.length.toLocaleString()} links${mode === 'overview' ? ` · overview of ${graphs.all.nodes.length.toLocaleString()} records` : ''}`;
    everyButton.setAttribute('aria-pressed', String(mode === 'all'));
    Object.assign(summary.dataset, { nodes: String(graph.nodes.length), edges: String(graph.edges.length), visibleNodes: String(visibleNodes.length), visibleEdges: String(showEdges ? visibleEdges.length : 0) });
    neighborButton.disabled = !selected; neighborButton.setAttribute('aria-pressed', String(neighborsOnly));
    empty.hidden = visibleNodes.length !== 0; empty.textContent = graph.nodes.length ? 'No records match this filter. Choose Show all.' : 'This model has no graph records yet.';
    resize();
  }
  function fit(ids = visibleNodes.map((node) => node.id)) {
    const bounds = new THREE.Box3(); for (const id of ids) bounds.expandByPoint(point(id));
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));
    const center = bounds.getCenter(new THREE.Vector3()), direction = new THREE.Vector3(.25, .2, 1).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize(), up = new THREE.Vector3().crossVectors(direction, right);
    const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), horizontal = vertical * camera.aspect;
    let distance = 30;
    for (const id of ids) {
      const offset = point(id).sub(center);
      distance = Math.max(distance, offset.dot(direction) + Math.max((Math.abs(offset.dot(right)) + 5) / horizontal, (Math.abs(offset.dot(up)) + 5) / vertical) * 1.15);
    }
    controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(.1, distance / 10000); camera.far = Math.max(20000, distance * 5); camera.updateProjectionMatrix(); controls.update();
  }
  function recenterView() {
    const damping = controls.enableDamping, rotating = controls.autoRotate;
    controls.enableDamping = false; controls.autoRotate = false; controls.update();
    fit(); controls.enableDamping = damping; controls.autoRotate = rotating; dirty = true;
  }
  function updateSearch() {
    const query = search.value.trim().toLocaleLowerCase(); searchResults.replaceChildren(); searchResults.hidden = !query;
    if (!query) { resize(); fit(); return; }
    const matches = graphs.all.nodes.filter((node) => `${node.label} ${node.nativeId}`.toLocaleLowerCase().includes(query));
    searchResults.append(element('p', `${matches.length} matching records${matches.length > 40 ? ' · showing the first 40' : ''}`));
    for (const node of matches.slice(0, 40)) { const choice = button(`${words(node.kind)} · ${node.label}`, () => { filter.value = ''; searchResults.hidden = true; if (!nodeById.has(node.id)) showRecords('all', false); select(node.id); }, searchResults); choice.className = 'graph-result'; }
    resize(); fit();
  }
  function select(id, notify = true) {
    const node = nodeById.get(id); if (!node) return; selected = id; rotating = false; controls.autoRotate = false; spinButton.setAttribute('aria-pressed', 'false');
    if (notify) onSelect({ kind: node.kind, id: node.nativeId });
    body.replaceChildren(element('div', words(node.kind), 'k'), element('div', node.label, 'v'), element('p', node.nativeId, 'a'));
    if (node.unresolved) body.append(element('p', node.reason ?? 'This reference has no record in the supplied snapshot. Its missing content is not inferred.'));
    if (node.withdrawn) body.append(element('p', 'Withdrawn record · retained as part of the model history.', 'm'));
    if (node.interval) body.append(element('p', formatModelInterval(node.interval, node.timeUnit), 'm'));
    if (node.contexts?.length) body.append(element('p', `Declared contexts: ${node.contexts.map((context) => typeof context === 'string' ? context : `${words(context.kind)} · ${context.event_id ?? context.eventId ?? context.root ?? ''}`).join('; ')}`, 'm'));
    const raw = node.record ?? {};
    if (node.kind === 'normalized_cut_answer') {
      const cut = nodeById.get(JSON.stringify(['normalized_cut', node.cutId]));
      body.append(element('p', `Local answer weight: ${raw.weight ?? 'not declared'} · ${cut?.record?.unit ?? 'unit not declared'}`, 'm'));
      if (cut) body.append(element('p', `Within ${cut.label}`, 'm'));
    }
    if (raw.description) body.append(element('p', raw.description, 'm'));
    if (raw.question) body.append(element('p', raw.question, 'm'));
    if (raw.conditioning) body.append(element('p', `Conditional on ${raw.conditioning.cut_id} → ${raw.conditioning.answer_key}. These weights apply within that answer.`, 'm'));
    if (Array.isArray(raw.answers)) {
      body.append(element('p', `Local answer weights · ${raw.unit ?? 'unit not declared'}`, 'a'));
      for (const answer of raw.answers) body.append(element('p', `${answer.key}: ${answer.weight ?? 'not declared'}`, 'm'));
    }
    const held = (node.holds ?? []).filter((item) => item.kind === 'normalized_cut');
    if (held.length) {
      const cuts = element('details'); cuts.open = held.length <= 3; cuts.append(element('summary', `Cuts on this ${words(node.kind)} (${held.length})`));
      for (const cut of held) {
        cuts.append(element('p', cut.label, 'm'), element('p', `${(cut.record?.answers ?? []).map((answer) => `${words(answer.key)} ${answer.weight ?? 'not declared'}`).join(' · ')} · ${cut.record?.unit ?? 'unit not declared'}${cut.record?.conditioning ? ` · within ${cut.record.conditioning.cut_id} → ${words(cut.record.conditioning.answer_key)}` : ''}`, 'a'));
      }
      body.append(cuts);
    }
    const passage = (data.story?.units ?? []).find((unit) => unit.id === node.nativeId && node.kind === 'narrative');
    if (passage) button('Read this passage', () => read(passage.id), body);
    const connected = incident.get(id) ?? [];
    const connections = element('details'); connections.open = true; connections.append(element('summary', `Connections (${connected.length})`));
    for (const edge of connected) {
      const outgoing = edge.source === id, other = nodeById.get(outgoing ? edge.target : edge.source);
      const choice = element('button', null, 'graph-neighbor'); choice.type = 'button';
      choice.append(element('small', `${outgoing ? '→ outgoing' : '← incoming'} · ${words(edge.kind)}${edge.relation && edge.relation !== edge.kind ? ` · ${edge.relation}` : ''}${edge.declared?.length > 1 ? ` · ${edge.declared.length} declared links` : ''}`), element('span', other?.label ?? 'Unresolved reference'));
      choice.addEventListener('click', () => { if (!other) return; filter.value = ''; select(other.id); fit([other.id, ...(incident.get(other.id) ?? []).flatMap((item) => [item.source, item.target])]); }); connections.append(choice);
      const evidence = element('details'); evidence.append(element('summary', 'Link details'));
      if (edge.path) evidence.append(element('small', `Native path: ${edge.path}`));
      if (edge.sourcePath) evidence.append(element('p', `Source anchor: ${edge.sourcePath}`, 'm'));
      if (edge.targetPath) evidence.append(element('p', `Target anchor: ${edge.targetPath}`, 'm'));
      evidence.addEventListener('toggle', () => { if (evidence.open && !evidence.querySelector('pre')) evidence.append(element('pre', JSON.stringify(edge.declared ? edge.declared.map((item) => item.record) : edge.record, null, 2))); });
      connections.append(evidence);
    }
    body.append(connections);
    const definition = element('details'); definition.append(element('summary', 'Full native record'), element('pre', JSON.stringify(raw, null, 2))); body.append(definition);
    detail.hidden = false; refresh(); fit([id, ...connected.flatMap((edge) => [edge.source, edge.target])]);
  }
  function showRecords(next, keep = true) {
    if (next === mode) return;
    const was = selected ? nodeById.get(selected) : null; useGraph(next); fillFilter(); fillKey(); neighborsOnly = false;
    const again = !was ? null : nodeById.has(was.id) ? was.id : next === 'overview' ? heldBy.get(was.id) ?? null : null;
    if (keep && again) select(again, false); else if (keep) { selected = null; detail.hidden = true; refresh(); fit(); }
  }
  detail.querySelector('.close').addEventListener('click', () => { detail.hidden = true; selected = null; onSelect(null); neighborsOnly = false; refresh(); fit(); });

  const readerElement = (id) => reader.querySelector(`#graph-${id}`), readerBody = readerElement('reader-body');
  const storyUnits = (data.story?.units ?? []).filter((unit) => unit.text?.trim()), articles = new Map();
  readerBody.replaceChildren();
  for (const unit of storyUnits) {
    const article = proseUnit(unit.text); article.className = ''; article.dataset.nodeId = unit.id; readerBody.append(article); articles.set(unit.id, article);
    const record = graph.nodes.find((node) => node.nativeId === unit.id && node.record?.text != null);
    if (record) { const reveal = element('button', 'Show this passage in the graph', 'graph-reveal'); reveal.type = 'button'; reveal.addEventListener('click', () => { reader.hidden = true; filter.value = ''; select(record.id); fit([record.id, ...(incident.get(record.id) ?? []).flatMap((edge) => [edge.source, edge.target])]); }); article.append(reveal); }
  }
  function read(id) {
    reader.hidden = false; reader.classList.add('full'); reader.scrollTop = 0;
    readerElement('reader-status').textContent = 'Complete document';
    if (id) articles.get(id)?.scrollIntoView({ block: 'start' });
  }
  if (storyUnits.length) button('Read full document', () => read());
  readerElement('reader-close').addEventListener('click', () => { reader.hidden = true; });
  readerElement('reader-start').addEventListener('click', () => { reader.scrollTop = 0; });
  readerElement('reader-full').hidden = true;
  reader.querySelector('.source').textContent = 'The complete document in its declared reading order.';
  readerElement('reader-download').addEventListener('click', () => {
    const blob = new Blob([storyUnits.map((unit) => unit.text).join('\n\n')], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = element('a');
    anchor.href = url; anchor.download = `${String(data.title ?? 'document').replace(/[^\p{L}\p{N} ._-]/gu, '_')}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  addEventListener('keydown', (event) => { if (active && event.key === 'Escape') { reader.hidden = true; searchResults.hidden = true; detail.hidden = true; selected = null; onSelect(null); neighborsOnly = false; refresh(); } }, { signal: abort.signal });
  function resize() {
    dirty = true;
    const titleRect = document.querySelector('.title').getBoundingClientRect(), toolsRect = document.getElementById('tools').getBoundingClientRect(), toggleRect = document.getElementById('toolbar-visibility').getBoundingClientRect();
    const narrow = innerWidth <= 760, top = Math.max(titleRect.bottom, narrow ? Math.max(toolsRect.bottom, toggleRect.bottom) : 0) + 12;
    const bottom = Math.min(summary.getBoundingClientRect().top, narrow && !detail.hidden ? detail.getBoundingClientRect().top : innerHeight) - 10;
    const sidebar = !detail.hidden ? detail.getBoundingClientRect() : toolsRect;
    const left = 12, right = !narrow && sidebar.width ? sidebar.left - 16 : innerWidth - 12;
    const width = Math.max(120, right - left), height = Math.max(100, bottom - top);
    Object.assign(host.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); labels.setSize(width, height);
  }
  refresh();
  addEventListener('resize', () => { if (active) { resize(); fit(); } }, { signal: abort.signal });
  addEventListener('viewer-controls-change', () => { if (active) resize(); }, { signal: abort.signal });
  css.addEventListener('load', () => { if (active) { resize(); fit(); } });
  function frame() {
    frameId = null; if (!alive || !active) return;
    const changed = !document.hidden && controls.update();
    if (!document.hidden && (dirty || changed)) {
    renderer.render(scene, camera); labels.render(scene, camera);
    const occupied = [document.querySelector('.title'), document.querySelector('#tools'), summary, ...(!detail.hidden ? [detail] : [])].map((node) => node.getBoundingClientRect());
    for (const item of labelItems) {
      const label = item.object.element; label.style.opacity = ''; const box = label.getBoundingClientRect();
      const overlap = occupied.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
      if (overlap) label.style.opacity = '0'; else occupied.push(box);
    }
    dirty = false;
    }
    frameId = requestAnimationFrame(frame);
  }
  return {
    recenter: recenterView,
    activate(_view, state) {
      active = true; controls.enabled = true; resize();
      // A record the overview holds is shown by what holds it; one it draws as a link opens every record.
      const wanted = state.selection && graphs.all.nodes.find((node) => node.kind === state.selection.kind && node.nativeId === state.selection.id);
      if (wanted && !nodeById.has(wanted.id) && mode === 'overview' && !heldBy.has(wanted.id)) showRecords('all', false);
      const choice = wanted && nodeById.get(nodeById.has(wanted.id) ? wanted.id : heldBy.get(wanted.id));
      if (choice && choice.id !== selected) { filter.value = ''; neighborsOnly = false; select(choice.id, false); }
      else if (!choice && selected) { selected = null; detail.hidden = true; neighborsOnly = false; refresh(); }
      fit(); dirty = true; if (frameId === null) frame();
    },
    deactivate() { active = false; controls.enabled = false; cancelAnimationFrame(frameId); frameId = null; },
    getState() { return { graph: { filter: filter.value, neighborsOnly, showEdges, rotating, records: mode } }; },
    destroy() { alive = false; active = false; abort.abort(); cancelAnimationFrame(frameId); controls.dispose(); renderer.dispose(); geometry.dispose(); material.dispose(); disposeLines(lines); disposeLines(selectedLines); css.remove(); },
  };
}
