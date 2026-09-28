// Coordinates stay in the model's reference frames. The lifetime overview connects declared location periods;
// its dashed links show their order, never a route or an inferred position between observations.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cameraState, restoreCamera, spaceFrameIdentity } from './live-viewer.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { proseUnit } from './inspector.js';
import { createWalker } from './walk-controls.js';
import { onPlainClick } from './pointer-click.js';
import { spaceModel, positionAt, presentAt, timeSpan, planeOf, lifeLocations, locationSequence, spaceConnections, spatialRecordText, resolveSpaceSelection, spaceToViewerTime, viewerToSpaceTime, placedEvents } from './space-model.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text);
  if (className) node.className = className; return node;
};
const button = (text, action, className = 'tool') => { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; };
const HUES = ['#9fc3ff', '#ffb057', '#93d3bd', '#dca4bd', '#c9b4f4', '#e5bd7b', '#7fe0e6'];
const roles = { home_base: 'Home', workplace: 'Work', visit: 'Visit', presence: 'Presence' };
const number = (value) => Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const short = (text, limit = 36) => String(text).length > limit ? `${String(text).slice(0, limit - 1).trim()}…` : String(text);
function timeText(t, unit) {
  if (!Number.isFinite(t)) return 'undated';
  if (String(unit).startsWith('civil_day_since_1970')) return new Date(t * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (/^years?$/u.test(String(unit))) { const year = Math.floor(t), month = Math.min(11, Math.floor((t - year) * 12)); return `${new Date(Date.UTC(2000, month, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${year}`; }
  return `${number(t)} ${unit ?? ''}`.trim();
}
const intervalText = (interval, unit) => {
  if (!interval) return 'No time declared';
  const start = timeText(interval.start, unit), end = timeText(interval.end, unit);
  return start === end ? start : `${start} – ${end}`;
};
const positionLabel = (object) => object.lifeLocation ? object.periodLabel || `${object.label} · ${object.placeLabel}` : object.label;
const periodCaption = (object) => (object.periodLabel || object.placeLabel || object.label).replace(/^[^·:]+[·:]\s*/u, '');
const qualification = (object) => [...new Set(['spatial_interpretation', 'spatial_status', 'precision_interpretation', 'temporal_interpretation', 'temporal_scope', 'temporal_domain', 'represented_point', 'reference_frame_definition', 'frame_origin_and_axes', 'spatial_extent'].map((key) => object.declaration[key]).filter(Boolean))];
const authored = (object) => /authored|fictional/u.test(qualification(object).join(' '));
// Geography only for a frame on the Earth: geodetic axes, or a named geodetic or projected reference system.
const geographic = (frame) => planeOf(frame).geo || /\b(EPSG|WGS ?84|OSGB|ETRS|UTM|geodetic)\b/iu.test(String(frame.frame ?? ''));
function projector(frame) {
  const plane = planeOf(frame);
  return { ...plane, point(object, position) { const { east, north, up } = plane.coordinates(object, position); return new THREE.Vector3(east, up, -north); } };
}

export function showSpace(data, { host, tools, detail, surface, onSelect = () => {} }) {
  const model = data.inspection?.model;
  if (!model) throw new Error('This snapshot lacks the model definition. Reopen it from the current MCP.');
  const space = spaceModel(model), connections = spaceConnections(data.inspection), body = detail.querySelector('.details-body');
  // The Events the model places, with the notes, passages and causal links that belong to them.
  const placement = placedEvents(model, data.inspection.graph ?? {}, space.frames);
  const abort = new AbortController(); let active = false, alive = true, frameId = null, dirty = true;
  const summary = element('aside', null, 'space-summary'); summary.setAttribute('aria-label', 'Space overview'); surface.append(summary);
  const overviewHead = element('div', null, 'space-overview-head'), count = element('strong'), note = element('span', null, 'space-overview-note');
  overviewHead.append(count, note); summary.append(overviewHead);
  const journeys = element('div', null, 'space-journeys'); summary.append(journeys);
  const contextLabel = element('div', null, 'space-context-label'); host.append(contextLabel);
  const frameHeading = element('strong'), frameCaption = element('span'); contextLabel.append(frameHeading, frameCaption);
  const detailsClose = detail.querySelector('.close');
  // The same bottom controls and reader belong to whichever representation is active.
  const playButton = document.getElementById('play'), track = document.getElementById('track'), fill = document.getElementById('fill'), clock = document.getElementById('clock');
  const reader = document.getElementById('reader');
  function renderStory() {
    const units = data.story?.units ?? [];
    document.getElementById('reader-body').replaceChildren(...units.map((unit) => { const article = proseUnit(String(unit.text ?? '')); article.dataset.nodeId = unit.id; return article; }));
    document.getElementById('reader-status').textContent = 'Full story · Complete manuscript'; document.getElementById('reader-scroll').scrollTop = 0;
  }
  const ownAction = (id, action) => document.getElementById(id).addEventListener('click', () => { if (active) action(); }, { signal: abort.signal });
  ownAction('read', () => { reader.hidden = false; renderStory(); });
  ownAction('reader-start', renderStory);
  ownAction('reader-close', () => { reader.hidden = true; });
  ownAction('reader-full', () => { reader.classList.toggle('full'); document.getElementById('reader-full').textContent = reader.classList.contains('full') ? 'Side view' : 'Full view'; });
  ownAction('reader-download', () => {
    const markdown = `${(data.story?.units ?? []).map((unit) => String(unit.text ?? '').trim()).filter(Boolean).join('\n\n')}\n`;
    const link = element('a'); link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); link.download = `${String(data.title ?? 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'}.md`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });
  // Escape closes the story and lets the selection go, as a click on nothing does.
  // What the details panel shows, so a second click on the same thing closes it.
  let shown = null;
  let letGo = () => { shown = null; if (!detail.hidden) { detail.hidden = true; onSelect(null); } };
  addEventListener('keydown', (event) => { if (active && event.key === 'Escape') { reader.hidden = true; letGo(); } }, { signal: abort.signal });

  // An open inspector ends above the window's edge and scrolls, so everything in it can be reached.
  const fitDetail = () => {
    if (detail.hidden) return;
    const bar = document.querySelector('.hud.bar')?.getBoundingClientRect(), floor = bar?.height ? bar.top - 8 : innerHeight - 12;
    detail.style.maxHeight = `${Math.max(120, floor - detail.getBoundingClientRect().top)}px`;
  };
  function showRecord(node, back = null) {
    if (!node) return;
    const record = node.record ?? {}, text = node.displayText ?? spatialRecordText(record);
    const titleText = node.kind === 'narrative' ? record.title || String(text).split(/\n/u)[0].replace(/^#+\s*/u, '') || node.label : node.label;
    const parts = [element('div', node.kind.replaceAll('_', ' '), 'k'), element('div', titleText, 'v')];
    if (back) parts.unshift(button(back.event ? '← Event' : '← Position', () => (back.event ? describeEvent(back) : describe(back)), 'space-back'));
    if (typeof text === 'string') parts.push(element('div', text, 'space-record-text'));
    if (record.interval) parts.push(element('p', intervalText(record.interval, space.timeUnit), 'a'));
    if (node.via?.length) parts.push(element('p', [...new Set(node.via.map((via) => via.relation))].join(' · '), 'a'));
    const raw = element('details'), title = element('summary', 'Record and provenance'); raw.append(title, element('pre', JSON.stringify(record, null, 2), 'space-raw')); parts.push(raw);
    body.replaceChildren(...parts); detail.hidden = false; shown = node; fitDetail(); onSelect({ kind: node.kind, id: node.nativeId }); if (active && space.frames.length) resize();
  }
  function settingList() {
    const list = element('div', null, 'space-settings');
    for (const setting of space.settings) {
      const item = element('details'), head = element('summary'); head.append(element('b', setting.name), element('span', ` · ${setting.events.length} Events`)); head.title = setting.boundary; item.append(head);
      for (const event of setting.events) {
        const entry = button(`${timeText(event.interval?.start, space.timeUnit)} · ${event.label}`, () => showRecord(connections.nodes.get(JSON.stringify(['event', event.id]))), 'space-related');
        item.append(entry);
        if (event.who.length) item.append(element('p', `Declared present: ${event.who.join(', ')}`, 'space-setting-note'));
        else if (event.participants.length) item.append(element('p', `Event participants: ${event.participants.join(', ')} · presence not specified`, 'space-setting-note'));
      }
      list.append(item);
    }
    return list;
  }
  if (!space.frames.length) {
    summary.classList.add('empty'); count.textContent = 'Places in the model';
    note.textContent = 'No coordinates are declared. These Events still connect people, places and passages.';
    journeys.append(settingList());
    detailsClose.addEventListener('click', () => letGo(), { signal: abort.signal });
    return { activate(_view, state) { active = true; playButton.disabled = true; playButton.textContent = '▶'; track.setAttribute('aria-disabled', 'true'); fill.style.width = '0%'; clock.textContent = 'No spatial clock'; const restored = resolveSpaceSelection([], connections, state?.selection); if (restored.node) showRecord(restored.node); else { shown = null; detail.hidden = true; } }, deactivate() { active = false; }, recenter() {}, coarse() { detail.hidden = true; summary.scrollTop = 0; }, getState: () => ({ space: { frames: 0 } }), destroy() { alive = false; abort.abort(); summary.remove(); } };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Space: declared locations and their sequence');
  const labels = new CSS2DRenderer(); labels.domElement.className = 'space-label-layer'; Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }); host.append(labels.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050608');
  scene.add(new THREE.AmbientLight('#b8caff', 1.6)); const light = new THREE.DirectionalLight('#ffffff', 2.8); light.position.set(30, 100, 40); scene.add(light);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.addEventListener('change', () => { dirty = true; });
  const walker = createWalker({ camera, controls, isActive: () => active, signal: abort.signal });
  renderer.domElement.title = 'Drag to turn · scroll to zoom · W A S D move, Q E down and up, arrows look around, Shift faster';
  const world = new THREE.Group(); scene.add(world);
  let span = null, t = 0, playing = false, frameIndex = 0, selected = null, focus = '', overview = false, showPaths = true, showText = true;
  let layers = { events: true, notes: true, causal: true }, showSummary = true, selectedEvent = null, eventItems = [], arcItems = [];
  let items = [], links = [], grid = null, axes = null, axisLabels = [], scale = 1, projection = null, center = new THREE.Vector3(), currentPeople = [];
  const sphere = new THREE.SphereGeometry(1, 20, 14), disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), ring = new THREE.RingGeometry(1.3, 1.65, 40).rotateX(-Math.PI / 2), octa = new THREE.OctahedronGeometry(0.85);
  const frameSelect = element('select', null, 'graph-control'); frameSelect.setAttribute('aria-label', 'Reference frame');
  space.frames.forEach((frame, i) => { const option = element('option', `${frame.lifeLocations.length ? 'Life locations' : frame.objects.some(authored) ? 'Scene layout' : geographic(frame) ? 'Geography' : 'Positions'} · ${frame.frame ?? 'Unnamed frame'}`); option.value = String(i); frameSelect.append(option); }); tools.append(frameSelect);
  const personSelect = element('select', null, 'graph-control'); personSelect.setAttribute('aria-label', 'Focus person'); tools.append(personSelect);
  const overviewButton = button('Whole life', () => { overview = !overview; update(); renderJourneys(); }, 'tool'); overviewButton.title = 'Show the whole declared location history or only the current time'; tools.append(overviewButton);
  const pathsButton = button('Paths', () => { showPaths = !showPaths; update(); }); pathsButton.setAttribute('aria-pressed', 'true'); pathsButton.title = 'Dashed connections show recorded order, not travel routes'; tools.append(pathsButton);
  const textButton = button('Text', () => { showText = !showText; update(); }); textButton.setAttribute('aria-pressed', 'true'); tools.append(textButton);
  // The panel below the map folds down to its one-line count, from its own button or this switch, giving the map its room.
  const toggleSummary = () => { showSummary = !showSummary; syncLayers(); resize(); fit(); };
  const timelineButton = button('Timeline', toggleSummary); timelineButton.title = 'Show or minimize the panel below the map'; tools.append(timelineButton);
  const minimizeButton = button('–', toggleSummary, 'space-minimize'); overviewHead.append(minimizeButton);
  // More of the model where it happens, each a layer: the Events it places, their notes and passages, their causal links.
  const layersWrap = element('span', null, 'tool-wrap space-layers'), layersPop = element('div', null, 'pop space-layers-pop');
  const layersButton = button('Layers ▾', () => { layersPop.hidden = !layersPop.hidden; layersButton.setAttribute('aria-expanded', String(!layersPop.hidden)); }); layersButton.setAttribute('aria-expanded', 'false');
  layersPop.hidden = true; layersPop.setAttribute('role', 'group'); layersPop.setAttribute('aria-label', 'Space layers');
  const attachedCount = placement.events.reduce((sum, item) => sum + item.notes.length + item.passages.length, 0);
  const layerRow = (key, name, count, about) => {
    const row = element('button', null, 'toggle space-layer'); row.type = 'button'; row.setAttribute('role', 'switch'); row.title = about;
    row.append(element('span', null, 'box'), element('span', name, 'name'), element('span', String(count), 'n'));
    row.addEventListener('click', () => { layers[key] = !layers[key]; syncLayers(); update(); }); layersPop.append(row); return row;
  };
  const layerRows = { events: layerRow('events', 'Events where they happen', placement.events.length, 'Events the model places: where a position they move stands, or at a place they are declared to be located in'),
    notes: layerRow('notes', 'Their notes and passages', attachedCount, 'Notes and passages the story graph links to those Events, as lights above them'),
    causal: layerRow('causal', 'Causal links between them', placement.causal.length, 'Declared causes, enables, constrains, prevents and realized forecasts between placed Events') };
  layersPop.append(element('p', 'Across the whole life, an Event\'s height shows when it happens, earliest lowest; at one time, the Events happening then stand just above their place.', 'note'),
    element('p', placement.unplaced ? `${placement.unplaced} other Events have no declared place, so they are not drawn here.` : 'Every Event has a declared place.', 'note'));
  layersWrap.append(layersButton, layersPop); tools.append(layersWrap);
  addEventListener('pointerdown', (event) => { if (!layersPop.hidden && !layersWrap.contains(event.target)) { layersPop.hidden = true; layersButton.setAttribute('aria-expanded', 'false'); } }, { signal: abort.signal });
  function syncLayers() {
    for (const [key, row] of Object.entries(layerRows)) { row.setAttribute('aria-checked', String(layers[key])); row.classList.toggle('on', layers[key]); }
    timelineButton.setAttribute('aria-pressed', String(showSummary)); summary.classList.toggle('minimized', !showSummary);
    minimizeButton.textContent = showSummary ? '–' : '+'; const label = showSummary ? 'Minimize this panel' : 'Show this panel'; minimizeButton.title = label; minimizeButton.setAttribute('aria-label', label); minimizeButton.setAttribute('aria-expanded', String(showSummary));
  }
  syncLayers();
  const togglePlay = () => { if (!span) return; playing = !playing; overview = false; if (playing && t >= span.end) t = span.start; update(); };
  ownAction('play', togglePlay);
  const seek = (fraction) => { if (!span) return; playing = false; overview = false; t = span.start + Math.max(0, Math.min(1, fraction)) * (span.end - span.start); update(); };
  let scrubbing = false;
  const fractionAt = (event) => { const bounds = track.getBoundingClientRect(); return (event.clientX - bounds.left) / bounds.width; };
  track.addEventListener('pointerdown', (event) => { if (!active || !span) return; scrubbing = true; track.setPointerCapture(event.pointerId); seek(fractionAt(event)); }, { signal: abort.signal });
  track.addEventListener('pointermove', (event) => { if (active && scrubbing) seek(fractionAt(event)); }, { signal: abort.signal });
  const finishScrub = () => { scrubbing = false; }; track.addEventListener('pointerup', finishScrub, { signal: abort.signal }); track.addEventListener('pointercancel', finishScrub, { signal: abort.signal });
  track.addEventListener('keydown', (event) => {
    if (!active || !span || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const fraction = (t - span.start) / (span.end - span.start);
    seek(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : fraction + (event.key === 'ArrowRight' ? 0.01 : -0.01));
  }, { signal: abort.signal });
  addEventListener('keydown', (event) => { if (!active || event.defaultPrevented || event.key !== ' ' || event.target.closest?.('input, textarea, select, button, [contenteditable], [role="slider"]')) return; event.preventDefault(); togglePlay(); }, { signal: abort.signal });
  const dispose = (object) => { if (!object) return; world.remove(object); object.geometry?.dispose?.(); object.material?.dispose?.(); };
  function clear() {
    for (const item of items) { world.remove(item.mesh, item.label, item.halo); item.mesh.material.dispose(); item.halo.material.dispose(); item.label.element.remove(); dispose(item.trail); if (item.spread) { world.remove(item.spread); item.spread.material.dispose(); } }
    for (const link of links) dispose(link.line);
    for (const item of eventItems) { world.remove(item.marker, item.label); item.marker.material.dispose(); item.label.element.remove(); dispose(item.stem); for (const light of item.lights) { world.remove(light); light.material.dispose(); } }
    for (const arc of arcItems) dispose(arc.line); eventItems = []; arcItems = [];
    for (const label of axisLabels) { world.remove(label); label.element.remove(); }
    dispose(grid); dispose(axes); grid = null; axes = null; items = []; links = []; axisLabels = [];
  }
  const hueFor = (object) => HUES[[...new Set(space.frames.flatMap((frame) => frame.objects.filter((item) => item.lifeLocation).map((item) => item.referentId)))].indexOf(object.referentId) % HUES.length] ?? '#9fc3ff';
  function showFrame(index, keepTime = true) {
    const oldTime = t; clear(); frameIndex = index; frameSelect.value = String(index); const frame = space.frames[index]; projection = projector(frame);
    currentPeople = lifeLocations(frame); personSelect.hidden = !currentPeople.length; overviewButton.hidden = !currentPeople.length;
    personSelect.replaceChildren(element('option', 'Everyone')); personSelect.firstChild.value = '';
    for (const person of currentPeople) { const option = element('option', person.label); option.value = person.id; personSelect.append(option); }
    if (!currentPeople.some((person) => person.id === focus)) focus = ''; personSelect.value = focus;
    span = timeSpan(frame, space.modelEnd);
    if (span) t = keepTime && oldTime >= span.start && oldTime <= span.end ? oldTime : span.start; else t = 0;
    overview = currentPeople.length > 0;
    const times = (object) => [...new Set([span?.start, span?.end, object.interval?.start, object.interval?.end, ...object.motion.flatMap((motion) => motion?.steps?.map((step) => step.t) ?? [])].filter(Number.isFinite))];
    const points = frame.objects.flatMap((object) => [0, ...times(object)].map((time) => positionAt(object, time)).filter(Boolean).map((position) => projection.point(object, position)));
    if (!points.length) points.push(...frame.objects.map((object) => projection.point(object, object.position)));
    const box = new THREE.Box3().setFromPoints(points), size = box.getSize(new THREE.Vector3()); box.getCenter(center);
    scale = 100 / Math.max(size.x, size.y, size.z, 1e-9); const width = Math.max(size.x, size.z) * scale * 1.35 || 100;
    grid = new THREE.GridHelper(width, 12, '#364457', '#18232d'); grid.material.transparent = true; grid.material.opacity = 0.55; grid.position.set(0, (box.min.y - center.y) * scale - 0.02, 0); world.add(grid);
    axes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-width / 2, 0, 0), new THREE.Vector3(width / 2, 0, 0), new THREE.Vector3(0, 0, width / 2), new THREE.Vector3(0, 0, -width / 2)]), new THREE.LineBasicMaterial({ color: '#41546c', transparent: true, opacity: 0.55 })); axes.position.copy(grid.position); world.add(axes);
    const axisName = (axis) => `${axis}${frame.unit ? ` · ${frame.unit}` : ''}`;
    for (const [text, at] of [[axisName(projection.east), new THREE.Vector3(width / 2, 0, 0)], [axisName(projection.north), new THREE.Vector3(0, 0, -width / 2)]]) { const label = new CSS2DObject(element('div', text, 'space-axis')); label.position.copy(at).add(grid.position); world.add(label); axisLabels.push(label); }
    const hueKeys = [...new Set(frame.objects.map((object) => object.referentId ?? object.id))];
    frame.objects.forEach((object) => {
      const hue = object.lifeLocation ? hueFor(object) : HUES[hueKeys.indexOf(object.referentId ?? object.id) % HUES.length];
      const mesh = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 0.24, metalness: 0.15, roughness: 0.4, transparent: true })); mesh.userData.object = object;
      const labelElement = element('button', short(positionLabel(object), 42), 'space-label'); labelElement.type = 'button'; labelElement.title = `${positionLabel(object)}\n${intervalText(object.interval, space.timeUnit)}`; labelElement.addEventListener('click', () => (shown === object && !detail.hidden ? letGo() : select(object)));
      const label = new CSS2DObject(labelElement); label.center.set(0.5, 1.7);
      const halo = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false }));
      let trail = null;
      if (object.moves && object.evaluated && span) {
        const samples = Array.from({ length: 65 }, (_, k) => span.start + (span.end - span.start) * k / 64).map((time) => positionAt(object, time)).filter(Boolean).map((position) => place(object, position));
        if (samples.length > 1) { trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples), new THREE.LineBasicMaterial({ color: hue, transparent: true, opacity: 0.45 })); world.add(trail); }
      }
      const half = (axis) => { const precision = object.precision[object.axes.indexOf(axis)]; return precision?.kind === 'standard_deviation' ? precision.value : precision?.kind === 'interval' ? (precision.upper - precision.lower) / 2 : 0; };
      const radius = Math.max(half(projection.east) * (projection.geo ? projection.narrow : 1), half(projection.north)) * scale;
      let spread = null;
      if (radius > 0) { spread = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })); spread.scale.setScalar(radius); world.add(spread); }
      world.add(mesh, label, halo); items.push({ object, mesh, label, trail, spread, halo, hue });
    });
    for (const link of locationSequence(frame)) {
      // A straight dashed connection makes the declared ordering visible. It does not simulate motion through gaps.
      const points = [place(link.source, link.source.position), place(link.target, link.target.position)];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: hueFor(link.source), dashSize: link.gap ? 0.6 : 1.5, gapSize: link.gap ? 1.2 : 0.7, transparent: true, opacity: 0.48 }));
      line.computeLineDistances(); world.add(line); links.push({ ...link, line });
    }
    // Events where the model places them, raised above their place and stacked when several share it; their notes and
    // passages as small lights above; causal links as arcs between them.
    const stacks = new Map();
    for (const placed of placement.events.filter((item) => item.frame === index)) {
      const when = placed.interval?.start ?? span?.start ?? 0;
      const points = placed.objects.map((object) => place(object, positionAt(object, when) ?? object.position));
      const base = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
      const key = `${Math.round(base.x)}|${Math.round(base.z)}`;
      const marker = new THREE.Mesh(octa, new THREE.MeshStandardMaterial({ color: '#f2efe6', emissive: '#f2efe6', emissiveIntensity: 0.3, transparent: true })); marker.userData.placed = placed;
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, base.clone()]), new THREE.LineBasicMaterial({ color: '#8b93a6', transparent: true, opacity: 0.35 }));
      const lights = [...placed.passages.map((item) => ({ ...item, color: '#fff0d0' })), ...placed.notes.map((item) => ({ ...item, color: '#c9d4ff' }))].slice(0, 12).map((item, k, all) => {
        const light = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: item.color, transparent: true, opacity: 0.9 })); light.scale.setScalar(0.42);
        light.userData.attachment = { ...item, placed }; light.userData.angle = k / all.length * Math.PI * 2; world.add(light); return light;
      });
      const labelElement = element('button', short(placed.event.boundary, 46), 'space-event-label'); labelElement.type = 'button'; labelElement.title = placed.event.boundary; labelElement.addEventListener('click', () => (shown === placed && !detail.hidden ? letGo() : selectEvent(placed)));
      const label = new CSS2DObject(labelElement); label.center.set(0.5, 1.5);
      world.add(marker, stem, label); eventItems.push({ placed, marker, stem, lights, label, base, key });
    }
    for (const relation of placement.causal) {
      const a = eventItems.find((item) => item.placed.id === relation.source_event_id), b = eventItems.find((item) => item.placed.id === relation.target_event_id);
      if (!a || !b) continue;
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff8a4c', transparent: true, opacity: 0.7 }));
      world.add(line); arcItems.push({ relation, line, a, b });
    }
    frameHeading.textContent = currentPeople.length ? 'Lives across places' : frame.objects.some(authored) ? 'Within a scene' : geographic(frame) ? 'Declared geography' : 'Declared positions';
    frameCaption.textContent = currentPeople.length ? 'Home, work and visits · select a period below' : frame.objects.some(authored) ? 'Authored layout · select a point to see its scope' : 'Coordinates in one shared reference frame';
    count.textContent = currentPeople.length ? `${currentPeople.length} lives · ${frame.lifeLocations.length} location periods` : `${frame.objects.length} declared positions`;
    note.textContent = currentPeople.length ? 'Dashed links show sequence, not travel routes. Hatched time is unrecorded. Home and work can overlap.' : frame.objects.some(authored) ? 'Fictional scene layout. Date ranges bound a representative moment, not a continuous stay.' : 'Reference points are shown to scale; a point does not define the extent of what it marks.';
    renderJourneys(); update(); fit(); if (active) resize();
  }
  function place(object, position) { return projection.point(object, position).sub(center).multiplyScalar(scale); }
  function renderJourneys() {
    journeys.replaceChildren(); journeys.hidden = !currentPeople.length;
    if (!span) return;
    const range = span.end - span.start, pct = (value) => `${Math.max(0, Math.min(100, (value - span.start) / range * 100))}%`;
    const axis = element('div', null, 'space-life-axis'); axis.append(element('span', timeText(span.start, space.timeUnit)), element('span', timeText(span.end, space.timeUnit))); journeys.append(axis);
    for (const person of currentPeople.filter((person) => !focus || person.id === focus)) {
      const row = element('div', null, 'space-life-row'), name = button(person.label, () => { focus = focus === person.id ? '' : person.id; personSelect.value = focus; renderJourneys(); update(); fit(); }, 'space-person'); name.style.setProperty('--person-color', hueFor(person.locations[0]));
      const lanes = element('div', null, 'space-life-lanes'); row.append(name, lanes);
      for (const role of [...new Set(person.locations.map((location) => location.locationRole ?? 'presence'))]) {
        const lane = element('div', null, 'space-life-lane'); lane.append(element('span', roles[role] ?? role, 'space-role'));
        const track = element('div', null, 'space-life-track'); track.setAttribute('aria-label', `${person.label}: ${roles[role] ?? role}`);
        const extent = element('i', null, 'space-life-extent');
        const lifeStart = Math.max(span.start, person.lifetime?.start ?? span.start), lifeEnd = Math.min(span.end, person.lifetime?.end ?? span.end);
        extent.style.left = pct(lifeStart); extent.style.width = `${Math.max(0, (lifeEnd - lifeStart) / range * 100)}%`; extent.title = 'Unrecorded within the modeled life'; track.append(extent);
        const cursor = element('i', null, 'space-life-cursor'); cursor.style.left = pct(t); track.append(cursor);
        for (const location of person.locations.filter((item) => (item.locationRole ?? 'presence') === role)) {
          if (!location.interval) continue;
          const bar = button(short(periodCaption(location), 32), () => { if (shown === location && !detail.hidden) { letGo(); return; } t = location.interval.start; select(location); update(); }, 'space-life-period');
          bar.style.left = pct(location.interval.start); bar.style.width = `${Math.max(0.35, (location.interval.end - location.interval.start) / range * 100)}%`; bar.style.setProperty('--person-color', hueFor(location));
          bar.title = `${location.periodLabel || `${person.label} · ${roles[role] ?? role} · ${location.placeLabel}`}\n${intervalText(location.interval, space.timeUnit)}`; bar.setAttribute('aria-label', bar.title); bar.dataset.position = location.id;
          if (location === selected) bar.classList.add('selected'); track.append(bar);
        }
        lane.append(track); lanes.append(lane);
      }
      if (person.gaps.length) { const gaps = element('details', null, 'space-gaps'); gaps.append(element('summary', `${person.gaps.length} unrecorded ${person.gaps.length === 1 ? 'period' : 'periods'}`)); for (const gap of person.gaps) gaps.append(element('p', intervalText(gap, space.timeUnit))); lanes.append(gaps); }
      journeys.append(row);
    }
  }
  function update() {
    for (const item of items) {
      const inFocus = !focus || !item.object.lifeLocation || item.object.referentId === focus;
      const here = presentAt(item.object, t), visible = inFocus && (overview || here), position = positionAt(item.object, t) ?? item.object.position;
      item.mesh.visible = item.label.visible = item.halo.visible = visible; if (item.spread) item.spread.visible = visible;
      item.mesh.position.copy(place(item.object, position)); item.label.position.copy(item.mesh.position); item.halo.position.copy(item.mesh.position); item.halo.position.y += 0.03;
      const isSelected = item.object === selected;
      item.mesh.scale.setScalar(isSelected ? 1.55 : item.object.lifeLocation ? 1 : 0.9); item.halo.scale.setScalar(isSelected ? 2 : item.object.lifeLocation ? 1.35 : 1);
      item.mesh.material.opacity = overview && !here && !isSelected ? 0.54 : 1;
      item.mesh.material.color.set(isSelected ? '#fff0b8' : item.hue); item.halo.material.opacity = isSelected ? 0.8 : 0.27;
      item.label.element.classList.toggle('selected', isSelected); item.label.element.style.visibility = showText && visible ? 'visible' : 'hidden';
      if (item.spread) item.spread.position.set(item.mesh.position.x, grid.position.y + 0.02, item.mesh.position.z);
      if (item.trail) item.trail.visible = inFocus && showPaths;
    }
    for (const link of links) link.line.visible = showPaths && (!focus || link.source.referentId === focus) && (overview || link.target.interval.start <= t);
    // An Event shows while it happens (or across the whole life), for the focused person when one is chosen. Across the
    // whole life its height is when it happens, earliest lowest, so a place's column reads as its chronology; at one time,
    // the few Events happening then stand just above their place.
    const current = eventItems.filter((item) => { const span2 = item.placed.interval; return !span2 || (t >= span2.start && t <= span2.end); });
    const levels = new Map(), starts = eventItems.map((item) => item.placed.interval?.start).filter(Number.isFinite);
    // Height runs over the placed Events' own dates, so a decade of Events is not squeezed into a lifetime.
    const first = Math.min(...starts), last = Math.max(...starts);
    for (const item of [...eventItems].sort((a, b) => (a.placed.interval?.start ?? 0) - (b.placed.interval?.start ?? 0))) {
      let height = 3;
      if (overview && Number.isFinite(item.placed.interval?.start) && last > first) height = 3 + 36 * (item.placed.interval.start - first) / (last - first);
      else { const level = levels.get(item.key) ?? 0; if (current.includes(item)) levels.set(item.key, level + 1); height = 3 + level * 1.7; }
      item.marker.position.copy(item.base).add(new THREE.Vector3(0, height, 0)); item.label.position.copy(item.marker.position);
      const stem = item.stem.geometry.attributes.position; stem.setXYZ(1, item.marker.position.x, item.marker.position.y, item.marker.position.z); stem.needsUpdate = true; item.stem.geometry.computeBoundingSphere();
      for (const light of item.lights) light.position.copy(item.marker.position).add(new THREE.Vector3(Math.cos(light.userData.angle) * 1.5, 0.95, Math.sin(light.userData.angle) * 1.5));
    }
    for (const arc of arcItems) {
      const from = arc.a.marker.position, to = arc.b.marker.position, lift = from.clone().add(to).multiplyScalar(0.5).add(new THREE.Vector3(0, from.distanceTo(to) * 0.35 + 2, 0));
      arc.line.geometry.setFromPoints(new THREE.QuadraticBezierCurve3(from.clone(), lift, to.clone()).getPoints(28));
    }
    for (const item of eventItems) {
      const { placed } = item, now = current.includes(item), isSelected = selectedEvent === placed;
      const theirs = !focus || placed.objects.some((object) => object.referentId === focus) || Object.values(placed.event.participants ?? {}).flat().includes(focus);
      const visible = layers.events && theirs && (overview || now || isSelected);
      item.marker.visible = item.stem.visible = visible; item.marker.material.opacity = overview && !now && !isSelected ? 0.5 : 1;
      item.marker.material.color.set(isSelected ? '#fff0b8' : '#f2efe6'); item.marker.scale.setScalar(isSelected ? 1.45 : 1);
      for (const light of item.lights) light.visible = visible && layers.notes;
      // Names only where they can be read: the chosen Event, or the few happening now.
      item.label.visible = visible && showText && (isSelected || (!overview && current.length <= 6));
    }
    for (const arc of arcItems) arc.line.visible = layers.causal && arc.a.marker.visible && arc.b.marker.visible;
    for (const label of axisLabels) label.visible = showText;
    overviewButton.setAttribute('aria-pressed', String(overview)); overviewButton.textContent = overview ? 'Whole life' : 'At this time';
    pathsButton.setAttribute('aria-pressed', String(showPaths)); textButton.setAttribute('aria-pressed', String(showText));
    if (active) {
      playButton.textContent = playing ? '❚❚' : '▶'; playButton.disabled = !span; playButton.setAttribute('aria-pressed', String(playing)); playButton.setAttribute('aria-label', playing ? 'Pause model time' : 'Play model time');
      track.setAttribute('role', 'slider'); track.tabIndex = 0; track.setAttribute('aria-label', 'Model time'); track.setAttribute('aria-disabled', String(!span));
      if (span) { track.setAttribute('aria-valuemin', String(span.start)); track.setAttribute('aria-valuemax', String(span.end)); track.setAttribute('aria-valuenow', String(t)); track.setAttribute('aria-valuetext', timeText(t, space.timeUnit)); }
      fill.style.width = `${span ? (overview ? 100 : Math.max(0, Math.min(100, (t - span.start) / (span.end - span.start) * 100))) : 0}%`;
      clock.textContent = span ? overview ? 'Whole life' : timeText(t, space.timeUnit) : 'No spatial clock';
      document.getElementById('coarse-view').setAttribute('aria-pressed', String(overview));
    }
    const focusedPerson = currentPeople.find((person) => person.id === focus);
    if (focusedPerson) count.textContent = `${focusedPerson.label} · ${focusedPerson.locations.length} location periods`;
    else if (currentPeople.length) count.textContent = `${currentPeople.length} lives · ${space.frames[frameIndex].lifeLocations.length} location periods`;
    for (const cursor of journeys.querySelectorAll('.space-life-cursor')) cursor.style.left = `${(t - span.start) / (span.end - span.start) * 100}%`;
    for (const bar of journeys.querySelectorAll('.space-life-period')) bar.classList.toggle('selected', bar.dataset.position === selected?.id);
    dirty = true;
  }
  function describe(object) {
    const position = positionAt(object, t), frame = space.frames[frameIndex];
    const lines = [element('div', object.lifeLocation ? `${roles[object.locationRole] ?? 'Location'} · lifetime context` : authored(object) ? 'Authored scene position' : 'Declared position', 'k'), element('div', positionLabel(object), 'v')];
    if (object.interval) lines.push(element('p', intervalText(object.interval, space.timeUnit), 'space-date'));
    if (object.lifeLocation && object.fullLabel) lines.push(element('p', object.fullLabel, 'a'));
    if (object.lifeLocation) lines.push(element('p', object.locationRole === 'home_base' ? 'A home base for this period. This does not claim the person stayed here continuously.' : object.locationRole === 'workplace' ? 'A place of work for this period. This does not replace their home or imply continuous presence.' : 'A bounded location record. Time between records remains unspecified.', 'space-qualification'));
    for (const text of qualification(object).filter((text) => !['coarse_life_location', 'authored_fictional_tableau', 'sourced_representative_geographical_point'].includes(text))) lines.push(element('p', text, 'space-qualification'));
    const coordinate = element('details', null, 'space-coordinate-detail'); coordinate.append(element('summary', 'Coordinates and source'));
    coordinate.append(element('p', `${frame.frame ?? 'Unnamed frame'}${frame.unit ? ` · ${frame.unit}` : ''}`, 'a'));
    coordinate.append(element('p', object.axes.map((axis, i) => `${axis} ${number((position ?? object.position)[i])}`).join(' · '), 'm'));
    if (!position && object.moves) coordinate.append(element('p', 'This is the initial value; its motion law is not evaluated here.', 'a'));
    const precision = object.axes.map((axis, i) => { const item = object.precision[i]; return item?.kind === 'standard_deviation' ? `${axis} ± ${number(item.value)}` : item?.kind === 'interval' ? `${axis} within ${number(item.lower)}–${number(item.upper)}` : item?.kind === 'exact' ? `${axis} exact within its declared model` : null; }).filter(Boolean);
    coordinate.append(element('p', precision.length ? precision.join(' · ') : 'Numerical uncertainty is not specified.', 'a'));
    for (const source of object.provenance) { const paragraph = element('p', null, 'a'); if (/^https?:\/\/\S+$/u.test(source)) { const link = element('a', source); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer'; paragraph.append(link); } else paragraph.textContent = source; coordinate.append(paragraph); }
    coordinate.append(element('p', `Records: ${object.processIds.join(', ')}`, 'a')); lines.push(coordinate);
    const related = connections.related(object), groups = [['period', 'This period: thoughts, Events and passages'], ['place', 'Broader place context'], ['person', 'Broader life context']];
    for (const [scope, title] of groups) {
      const members = related.filter((node) => node.scope === scope); if (!members.length) continue;
      const section = element('details', null, 'space-connections'); section.open = scope === 'period'; section.append(element('summary', `${title} · ${members.length}`));
      if (scope !== 'period') section.append(element('p', 'Linked to this place or person; not necessarily about the selected period.', 'a'));
      for (const node of members) { const entry = button(short(node.label, 100), () => showRecord(node, object), 'space-related'); entry.title = node.label; section.append(entry); }
      lines.push(section);
    }
    if (!related.length) lines.push(element('p', 'No declared model connections were found for this position.', 'a'));
    body.replaceChildren(...lines); detail.hidden = false; shown = object; if (active) resize();
  }
  // An Event where it happens: what it is, where and when, and what is attached to it.
  function describeEvent(placed) {
    const { event } = placed, lines = [element('div', 'Event where it happens', 'k'), element('div', event.boundary, 'v')];
    if (placed.interval) lines.push(element('p', intervalText(placed.interval, space.timeUnit), 'space-date'));
    if (event.description) lines.push(element('p', event.description, 'm'));
    const placeNode = placed.placeId ? connections.nodes.get(JSON.stringify(['referent', placed.placeId])) : null;
    lines.push(element('p', placed.via === 'place' ? `Declared to be located in ${placeNode?.label ?? placed.placeId}.` : `It moves ${placed.objects.length === 1 ? 'this declared position' : `these ${placed.objects.length} declared positions`}: ${placed.objects.map((object) => positionLabel(object)).join('; ')}.`, 'a'));
    const section = (title, members, open, action) => { if (!members.length) return; const box = element('details', null, 'space-connections'); box.open = open; box.append(element('summary', `${title} · ${members.length}`)); for (const [label, fn] of members.map(action)) { const entry = button(short(label, 100), fn, 'space-related'); entry.title = label; box.append(entry); } lines.push(box); };
    const record = (item) => { const node = connections.nodes.get(JSON.stringify(['narrative', item.node.id])); const text = node ? (node.record?.title || spatialRecordText(node.record).split(/\n/u)[0].replace(/^#+\s*/u, '') || node.label) : item.node.id; return [text, () => showRecord(node, placed)]; };
    section('Passages that tell it', placed.passages, true, record);
    section('Notes about it', placed.notes, placed.passages.length === 0, record);
    const causes = placement.causal.filter((relation) => relation.source_event_id === event.id || relation.target_event_id === event.id);
    section('Causal links', causes, true, (relation) => { const other = placement.events.find((item) => item.id === (relation.source_event_id === event.id ? relation.target_event_id : relation.source_event_id)); return [`${relation.source_event_id === event.id ? `${relation.kind} →` : `← ${relation.kind}`} ${other?.event.boundary ?? ''}`, () => other && selectEvent(other)]; });
    body.replaceChildren(...lines); detail.hidden = false; shown = placed; if (active) resize();
  }
  function selectEvent(placed, notify = true) {
    selectedEvent = placed; selected = null; if (placed.frame !== frameIndex) showFrame(placed.frame);
    describeEvent(placed); if (notify) onSelect({ kind: 'event', id: placed.id }); update();
  }
  function select(object, notify = true) {
    selected = object;
    if (!object) { detail.hidden = true; shown = null; }
    else { describe(object); if (notify) onSelect({ kind: 'process', id: object.processIds[0] }); }
    update(); if (active) resize();
  }
  // Letting go clears what is selected here and in every other representation.
  letGo = () => { if (!selected && !selectedEvent && detail.hidden) return; selectedEvent = null; select(null); onSelect(null); };
  detailsClose.addEventListener('click', letGo, { signal: abort.signal });
  // A plain click picks what is under it; a click on nothing, or on what is already open, lets it go.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  onPlainClick(renderer.domElement, (event) => {
    const rect = renderer.domElement.getBoundingClientRect(); ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(ndc, camera);
    const targets = [...items.filter((item) => item.mesh.visible).map((item) => item.mesh), ...eventItems.filter((item) => item.marker.visible).flatMap((item) => [item.marker, ...item.lights.filter((light) => light.visible)])];
    const hit = ray.intersectObjects(targets)[0], data2 = hit?.object.userData ?? {};
    const passage = data2.attachment ? connections.nodes.get(JSON.stringify(['narrative', data2.attachment.node.id])) : null;
    const target = data2.placed ?? passage ?? data2.object ?? null;
    if (!target || (target === shown && !detail.hidden)) { letGo(); return; }
    if (data2.placed) selectEvent(data2.placed);
    else if (passage) { selectEvent(data2.attachment.placed, false); showRecord(passage, data2.attachment.placed); }
    else { selectedEvent = null; select(data2.object); }
  }, { signal: abort.signal });
  frameSelect.addEventListener('change', () => { letGo(); showFrame(Number(frameSelect.value)); });
  personSelect.addEventListener('change', () => { focus = personSelect.value; renderJourneys(); update(); fit(); });
  function fit() {
    const bounds = new THREE.Box3(); for (const item of items) if ((!focus || item.object.referentId === focus) && (overview || item.mesh.visible)) bounds.expandByPoint(item.mesh.position);
    if (bounds.isEmpty()) for (const item of items) bounds.expandByPoint(item.mesh.position);
    const middle = bounds.getCenter(new THREE.Vector3()), radius = Math.max(12, bounds.getSize(new THREE.Vector3()).length() / 2);
    const vertical = THREE.MathUtils.degToRad(camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.2;
    controls.target.copy(middle); camera.position.copy(middle).add(new THREE.Vector3(0.12, 1.6, 1.45).normalize().multiplyScalar(distance)); camera.near = Math.max(0.1, radius / 1000); camera.far = radius * 70; camera.updateProjectionMatrix(); controls.update(); dirty = true;
  }
  function resize() {
    fitDetail();
    const titleRect = document.querySelector('.title').getBoundingClientRect(), toolsRect = document.getElementById('tools').getBoundingClientRect();
    // Without the panel below, the map reaches down to the play bar.
    const floor = showSummary ? summary.getBoundingClientRect().top : document.getElementById('track')?.closest?.('.bar')?.getBoundingClientRect().top ?? innerHeight;
    // The map fills the window below the row of controls.
    const narrow = innerWidth <= 760, top = Math.max(titleRect.bottom, toolsRect.bottom) + 10, bottom = floor - 10;
    // The map stays wide when only controls are visible; an open inspector reserves a genuine reading column.
    const left = 12, right = !narrow && !detail.hidden ? detail.getBoundingClientRect().left - 16 : innerWidth - 12;
    const width = Math.max(120, right - left), height = Math.max(100, bottom - top);
    Object.assign(host.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); labels.setSize(width, height); dirty = true;
  }
  // Keep the selected label, then only labels with free screen space. All records remain available in the timeline.
  function arrangeLabels() {
    const occupied = [], width = host.clientWidth, height = host.clientHeight;
    const ordered = [...items].sort((a, b) => Number(b.object === selected) - Number(a.object === selected) || Number(b.object.lifeLocation) - Number(a.object.lifeLocation));
    for (const item of ordered) {
      const node = item.label.element;
      if (!showText || !item.mesh.visible) { node.style.visibility = 'hidden'; continue; }
      const point = item.mesh.position.clone().project(camera), x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
      const w = Math.min(250, Math.max(70, node.textContent.length * 6.8)), rect = { x: x - w / 2, y: y - 31, w, h: 28 };
      const outside = point.z > 1 || rect.x < 0 || rect.x + w > width || rect.y < 0 || rect.y + rect.h > height;
      const collision = occupied.some((other) => rect.x < other.x + other.w + 7 && rect.x + w + 7 > other.x && rect.y < other.y + other.h + 3 && rect.y + rect.h + 3 > other.y);
      node.style.visibility = !outside && (!collision || item.object === selected) ? 'visible' : 'hidden';
      if (node.style.visibility === 'visible') occupied.push(rect);
    }
  }
  addEventListener('resize', () => { if (active) resize(); }, { signal: abort.signal });
  addEventListener('viewer-controls-change', () => { if (active) resize(); }, { signal: abort.signal });
  let last = performance.now();
  function animate(now = performance.now()) {
    frameId = null; if (!alive || !active) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && span) { t = Math.min(span.end, t + dt * (span.end - span.start) / 45); if (t >= span.end) playing = false; update(); }
    if (walker.step(dt)) dirty = true;
    const changed = controls.update();
    if (!document.hidden && (dirty || changed)) { renderer.render(scene, camera); labels.render(scene, camera); arrangeLabels(); dirty = false; }
    frameId = requestAnimationFrame(animate);
  }
  showFrame(Math.max(0, space.frames.findIndex((frame) => frame.lifeLocations.length)), false);
  return {
    recenter: fit,
    coarse() { playing = false; focus = ''; personSelect.value = ''; const index = space.frames.findIndex((frame) => frame.lifeLocations.length); if (index >= 0 && index !== frameIndex) showFrame(index); overview = true; renderJourneys(); update(); resize(); fit(); },
    activate(_view, state) {
      active = true; controls.enabled = true;
      const savedFrame = state.space?.frameKey ? space.frames.findIndex((frame) => spaceFrameIdentity(frame) === state.space.frameKey) : state.space?.frame;
      if (state.space) { if (Number.isInteger(savedFrame) && space.frames[savedFrame] && savedFrame !== frameIndex) showFrame(savedFrame); t = state.space.time ?? t; focus = state.space.focus ?? focus; overview = state.space.overview ?? overview; personSelect.value = focus; }
      if (state.time?.mode === 'story' && Number.isFinite(state.time.now)) { t = viewerToSpaceTime(state.time.now, space.timeUnit); if (!state.space) overview = Boolean(state.time.atEnd); }
      const restored = resolveSpaceSelection(space.frames, connections, state.selection, frameIndex);
      if (selectedEvent && !(state.selection?.kind === 'event' && state.selection.id === selectedEvent.id)) selectedEvent = null;
      if (restored.frame !== frameIndex) showFrame(restored.frame);
      if (restored.object) selected = restored.object;
      if (restored.node && !['process', 'referent'].includes(state.selection.kind)) showRecord(restored.node, restored.object);
      else if (restored.object) select(restored.object, false);
      // A selection let go elsewhere, or one Space cannot show, leaves nothing open here.
      else { selectedEvent = null; select(null, false); }
      renderJourneys(); update(); resize(); fit(); if (savedFrame === frameIndex) restoreCamera(camera, controls, state.spaceCamera); last = performance.now(); if (frameId === null) animate();
    },
    deactivate() { active = false; controls.enabled = false; playing = false; walker.stop(); cancelAnimationFrame(frameId); frameId = null; },
    // Whole-life is a spatial presentation, not the temporal renderer's instruction to jump to its window end.
    getState() { return { space: { frame: frameIndex, frameKey: spaceFrameIdentity(space.frames?.[frameIndex]), time: t, focus, overview }, time: { mode: 'story', now: spaceToViewerTime(t, space.timeUnit), atEnd: false }, spaceCamera: cameraState(camera, controls) }; },
    destroy() { alive = false; active = false; abort.abort(); cancelAnimationFrame(frameId); clear(); controls.dispose(); renderer.dispose(); sphere.dispose(); disc.dispose(); ring.dispose(); octa.dispose(); summary.remove(); },
  };
}
