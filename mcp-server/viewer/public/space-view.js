// The physical view: things where the model declares them, to scale, in the model's own reference frames. Only
// declared positions are placed (see space-model.js); a model without them says what would place its things.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { spaceModel, positionAt } from './space-model.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text != null) node.textContent = String(text);
  if (className) node.className = className; return node;
};
const HUES = ['#9fc3ff', '#ffb057', '#93d3bd', '#dca4bd', '#c9b4f4', '#e5bd7b', '#7fe0e6'];
const number = (value) => (Math.abs(value) >= 1000 || Number.isInteger(value) ? value.toLocaleString('en-GB', { maximumFractionDigits: 1 }) : value.toLocaleString('en-GB', { maximumSignificantDigits: 4 }));
// A model time in words: a calendar date for calendar clocks, else the number in the model's own unit.
function timeText(t, unit) {
  if (!Number.isFinite(t)) return 'undated';
  if (String(unit).startsWith('civil_day_since_1970')) return new Date(t * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (/^years?$/u.test(String(unit))) { const year = Math.floor(t), month = Math.min(11, Math.floor((t - year) * 12)); return `${new Date(Date.UTC(2000, month, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${year}`; }
  return `${number(t)} ${unit ?? ''}`.trim();
}

// Where a declared coordinate goes in the scene: x east, y north (away from the viewer), z up; latitude and longitude
// as a map, longitude narrowed by the cosine of the frame's middle latitude.
function projector(frame) {
  const axes = frame.axes; const geo = axes.includes('latitude') && axes.includes('longitude');
  const latitudes = geo ? frame.objects.map((object) => object.position[object.axes.indexOf('latitude')]).filter(Number.isFinite) : [];
  const narrow = geo && latitudes.length ? Math.cos((latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length) * Math.PI / 180) : 1;
  const east = geo ? 'longitude' : 'x', north = geo ? 'latitude' : 'y', up = geo ? (axes.includes('altitude') ? 'altitude' : 'z') : 'z';
  return { geo, east, north, up, point(object, position) {
    const at = (axis) => { const i = object.axes.indexOf(axis); return i >= 0 ? position[i] : 0; };
    // A coordinate on an axis other than these three is shown in the details, not drawn.
    return new THREE.Vector3(at(east) * (geo ? narrow : 1), at(up), -at(north));
  } };
}

export function showSpace(data, { host, tools, detail, surface, onSelect = () => {} }) {
  const model = data.inspection?.model;
  if (!model) throw new Error('This snapshot lacks the model definition. Reopen it from the current MCP.');
  const space = spaceModel(model);
  const body = detail.querySelector('.details-body');
  const abort = new AbortController(); let active = false, alive = true, frameId = null, dirty = true;
  const summary = element('aside', null, 'space-summary'); summary.setAttribute('aria-label', 'Space overview'); surface.append(summary);
  const unplacedText = () => [
    space.unplacedReferents.length ? `${space.unplacedReferents.length} ${space.unplacedReferents.length === 1 ? 'referent has' : 'referents have'} no declared coordinates` : null,
    space.textRegions.length ? (space.textRegions.length === 1 ? '1 place is named only in words, as an Event\'s region, and is not placed' : `${space.textRegions.length} places are named only in words, as Events' regions, and are not placed`) : null,
  ].filter(Boolean).join(' · ');

  if (!space.frames.length) {
    // Nothing to draw: say what would place the model's things, in the grammar it already has, and show where the model
    // does say things happen, without geometry.
    summary.classList.add('empty');
    summary.append(element('strong', 'This model declares no coordinates.'),
      element('p', 'A thing is drawn in space when the model gives it coordinates: a process whose value is a pose (object_pose) or a position vector, or scalar processes with scale semantic_role "position" and an axis, all in a named reference frame and unit. A binding from the process to a referent says whose position it is; an evolution law with a constant or a static velocity moves it.'));
    if (space.settings.length) {
      const list = element('div', null, 'space-settings');
      list.append(element('h2', `Where things happen, as declared: ${space.settings.length} ${space.settings.length === 1 ? 'place' : 'places'}, no geometry`));
      for (const setting of space.settings) {
        const item = element('details'), head = element('summary'), first = setting.events[0]?.interval?.start, last = Math.max(...setting.events.map((event) => event.interval?.end ?? event.interval?.start ?? -Infinity));
        const from = timeText(first, space.timeUnit), to = Number.isFinite(last) ? timeText(last, space.timeUnit) : from;
        head.append(element('b', setting.name), element('span', ` · ${from}${to !== from ? ` – ${to}` : ''}${setting.who.length ? ` · ${setting.who.join(', ')}` : ''}`));
        head.title = setting.boundary; item.append(head);
        for (const event of setting.events) {
          item.append(element('p', `${timeText(event.interval?.start, space.timeUnit)} · ${event.label}${event.who.length ? ` · ${event.who.join(', ')}` : ''}`, 'space-setting-event'));
          if (event.description) item.append(element('p', event.description, 'space-setting-note'));
        }
        list.append(item);
      }
      summary.append(list);
    }
    summary.append(element('p', unplacedText() || 'No referents or named places are waiting for positions.', 'space-regions'));
    if (space.textRegions.length) summary.append(element('p', `Named in words: ${space.textRegions.slice(0, 8).join('; ')}${space.textRegions.length > 8 ? '; …' : ''}`, 'space-regions'));
    return { activate() { active = true; }, deactivate() { active = false; }, recenter() {}, getState: () => ({ space: { frames: 0 } }), destroy() { alive = false; summary.remove(); } };
  }

  // Fail before attaching controls if this browser cannot create 3D.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3D view of declared positions');
  const labels = new CSS2DRenderer(); Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' }); host.append(labels.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050608');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.addEventListener('change', () => { dirty = true; });
  const world = new THREE.Group(); scene.add(world);

  // Time: the model's start (0) to the end of its latest Event, when anything moves by a declared law.
  const ends = (model.meaning_model?.events ?? []).map((event) => event?.interval?.end).filter(Number.isFinite);
  const horizon = Math.max(1, ...ends);
  let t = 0, playing = false, frameIndex = 0, selected = null;
  const frameSelect = element('select', null, 'graph-control'); frameSelect.setAttribute('aria-label', 'Reference frame');
  space.frames.forEach((frame, i) => { const option = element('option', `${frame.frame ?? 'Unnamed frame'}${frame.unit ? ` · ${frame.unit}` : ''} (${frame.objects.length})`); option.value = String(i); frameSelect.append(option); });
  if (space.frames.length > 1) tools.append(frameSelect);
  const playButton = element('button', 'Play', 'tool'); playButton.type = 'button'; playButton.setAttribute('aria-pressed', 'false');
  const slider = element('input', null, 'space-time'); slider.type = 'range'; slider.min = '0'; slider.max = String(horizon); slider.step = String(horizon / 500); slider.value = '0'; slider.setAttribute('aria-label', 'Model time');
  const clock = element('span', null, 'space-clock');
  const timeRow = element('span', null, 'space-time-row'); timeRow.append(playButton, slider, clock); tools.append(timeRow);
  const count = element('strong'), note = element('span'), unplaced = element('span', unplacedText());
  summary.append(count, note, unplaced);

  let items = [], grid = null, axes = null, axisLabels = [], scale = 1, projection = null, center = new THREE.Vector3();
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  function clear() {
    for (const item of items) { world.remove(item.mesh, item.label, item.trail); item.mesh.material.dispose(); item.label.element.remove(); if (item.trail) { item.trail.geometry.dispose(); item.trail.material.dispose(); } }
    for (const label of axisLabels) { world.remove(label); label.element.remove(); }
    if (grid) { world.remove(grid); grid.geometry.dispose(); grid.material.dispose(); } if (axes) { world.remove(axes); axes.geometry.dispose(); axes.material.dispose(); }
    items = []; axisLabels = [];
  }
  // One frame at a time: coordinates in different frames are not in one space.
  function showFrame(index) {
    clear(); frameIndex = index; const frame = space.frames[index]; projection = projector(frame);
    const moving = frame.objects.some((object) => object.moves);
    timeRow.hidden = !moving;
    // The same scale on every axis, so distances stay true to each other.
    const points = frame.objects.flatMap((object) => [0, horizon].map((time) => positionAt(object, time)).filter(Boolean).map((position) => projection.point(object, position)));
    const box = new THREE.Box3().setFromPoints(points); const size = box.getSize(new THREE.Vector3()); box.getCenter(center);
    const extent = Math.max(size.x, size.y, size.z, 1e-9); scale = 100 / extent;
    const span = Math.max(size.x, size.z) * scale * 1.3 || 100;
    grid = new THREE.GridHelper(span, 10, '#39404f', '#1d222c'); grid.position.set(0, (box.min.y - center.y) * scale, 0); world.add(grid);
    const axisPoints = [new THREE.Vector3(-span / 2, 0, 0), new THREE.Vector3(span / 2, 0, 0), new THREE.Vector3(0, 0, span / 2), new THREE.Vector3(0, 0, -span / 2)];
    axes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(axisPoints), new THREE.LineBasicMaterial({ color: '#59627a' })); axes.position.copy(grid.position); world.add(axes);
    const axisName = (axis) => `${axis}${frame.unit ? ` (${frame.unit})` : ''}`;
    for (const [text, at] of [[axisName(projection.east), new THREE.Vector3(span / 2, 0, 0)], [axisName(projection.north), new THREE.Vector3(0, 0, -span / 2)]]) {
      const label = new CSS2DObject(element('div', text, 'space-axis')); label.position.copy(at).add(grid.position); world.add(label); axisLabels.push(label);
    }
    frame.objects.forEach((object, i) => {
      const hue = HUES[i % HUES.length];
      const mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: hue })); mesh.scale.setScalar(1.6); mesh.userData.object = object;
      const label = new CSS2DObject(element('div', object.label, 'space-label')); label.center.set(0.5, 1.4);
      let trail = null;
      if (object.moves && object.evaluated) {
        const samples = Array.from({ length: 33 }, (_, k) => place(object, positionAt(object, horizon * k / 32)));
        trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples), new THREE.LineBasicMaterial({ color: hue, transparent: true, opacity: 0.45 }));
        world.add(trail);
      }
      world.add(mesh, label); items.push({ object, mesh, label, trail });
    });
    count.textContent = `${frame.objects.length} ${frame.objects.length === 1 ? 'thing' : 'things'} in ${frame.frame ?? 'an unnamed frame'}${frame.unit ? `, in ${frame.unit}` : ''}`;
    note.textContent = 'Declared coordinates, to scale. Only records with a declared position are placed.';
    update(); fit();
  }
  function place(object, position) { return projection.point(object, position).sub(center).multiplyScalar(scale); }
  function update() {
    for (const item of items) {
      const position = positionAt(item.object, t) ?? item.object.position;
      item.mesh.position.copy(place(item.object, position)); item.label.position.copy(item.mesh.position);
      item.mesh.material.color.set(item.object === selected ? '#fff0b8' : HUES[items.indexOf(item) % HUES.length]);
      item.label.element.classList.toggle('selected', item.object === selected);
    }
    clock.textContent = `${number(t)} ${space.timeUnit ?? ''} after the model's start`.trim();
    if (selected) describe(selected);
    dirty = true;
  }
  function describe(object) {
    const position = positionAt(object, t);
    const lines = [element('div', 'A declared position', 'k'), element('div', object.label, 'v')];
    const frame = space.frames[frameIndex];
    lines.push(element('p', `${frame.frame ?? 'Unnamed frame'}${frame.unit ? ` · ${frame.unit}` : ''}`, 'a'));
    const shown = position ?? object.position;
    lines.push(element('p', object.axes.map((axis, i) => `${axis} ${number(shown[i])}`).join(' · '), 'm'));
    if (!position) lines.push(element('p', 'A law moves it that the viewer does not evaluate; this is its declared start.', 'a'));
    if (object.orientation) lines.push(element('p', `Orientation: ${object.orientation.map(number).join(', ')}`, 'a'));
    object.rates.forEach((rate, i) => { if (rate) lines.push(element('p', `Moves ${number(rate)} ${frame.unit ?? ''} per ${space.timeUnit ?? 'time unit'} along ${object.axes[i]}`, 'a')); });
    if (object.laws.length) lines.push(element('p', `Laws: ${object.laws.join(', ')}`, 'a'));
    lines.push(element('p', `Declared by ${object.processIds.join(', ')}${object.referentId ? `, bound to ${object.referentId}` : ''}`, 'a'));
    body.replaceChildren(...lines); detail.hidden = false;
  }
  function select(object, notify = true) {
    selected = object; if (!object) { detail.hidden = true; update(); return; }
    if (notify) onSelect(object.referentId ? { kind: 'referent', id: object.referentId } : { kind: 'process', id: object.processIds[0] });
    update();
  }
  detail.querySelector('.close').addEventListener('click', () => { select(null); onSelect(null); });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
    down = null; const rect = renderer.domElement.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(items.map((item) => item.mesh))[0]; select(hit ? hit.object.userData.object : null);
  });
  frameSelect.addEventListener('change', () => { selected = null; detail.hidden = true; showFrame(Number(frameSelect.value)); });
  slider.addEventListener('input', () => { t = Number(slider.value); update(); });
  playButton.addEventListener('click', () => { playing = !playing; playButton.setAttribute('aria-pressed', String(playing)); playButton.textContent = playing ? 'Pause' : 'Play'; if (playing && t >= horizon) t = 0; });
  function fit() {
    const bounds = new THREE.Box3(); for (const item of items) bounds.expandByPoint(item.mesh.position); if (grid) bounds.expandByObject(grid);
    const middle = bounds.getCenter(new THREE.Vector3()); const radius = Math.max(10, bounds.getSize(new THREE.Vector3()).length() / 2);
    controls.target.copy(middle); camera.position.copy(middle).add(new THREE.Vector3(0, radius * 0.9, radius * 1.35));
    camera.near = Math.max(0.1, radius / 1000); camera.far = radius * 50; camera.updateProjectionMatrix(); controls.update(); dirty = true;
  }
  function resize() {
    const titleRect = document.querySelector('.title').getBoundingClientRect(), toolsRect = document.getElementById('tools').getBoundingClientRect();
    const narrow = innerWidth <= 760, top = Math.max(titleRect.bottom, narrow ? toolsRect.bottom : 0) + 12;
    const bottom = summary.getBoundingClientRect().top - 10, sidebar = !detail.hidden ? detail.getBoundingClientRect() : toolsRect;
    const left = 12, right = !narrow && sidebar.width ? sidebar.left - 16 : innerWidth - 12;
    const width = Math.max(120, right - left), height = Math.max(100, bottom - top);
    Object.assign(host.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); labels.setSize(width, height); dirty = true;
  }
  addEventListener('resize', () => { if (active) resize(); }, { signal: abort.signal });
  addEventListener('viewer-controls-change', () => { if (active) resize(); }, { signal: abort.signal });
  let last = performance.now();
  function frame(now = performance.now()) {
    frameId = null; if (!alive || !active) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing) { t = Math.min(horizon, t + dt * horizon / 12); slider.value = String(t); update(); if (t >= horizon) { playing = false; playButton.setAttribute('aria-pressed', 'false'); playButton.textContent = 'Play'; } }
    const changed = controls.update();
    if (!document.hidden && (dirty || changed)) { renderer.render(scene, camera); labels.render(scene, camera); dirty = false; }
    frameId = requestAnimationFrame(frame);
  }
  showFrame(0);
  return {
    recenter: fit,
    activate(_view, state) {
      active = true; controls.enabled = true; resize();
      const wanted = state.selection && items.find((item) => (state.selection.kind === 'referent' && item.object.referentId === state.selection.id) || (state.selection.kind === 'process' && item.object.processIds.includes(state.selection.id)));
      if (wanted && wanted.object !== selected) select(wanted.object, false);
      fit(); last = performance.now(); if (frameId === null) frame();
    },
    deactivate() { active = false; controls.enabled = false; playing = false; cancelAnimationFrame(frameId); frameId = null; },
    getState() { return { space: { frame: frameIndex, time: t } }; },
    destroy() { alive = false; active = false; abort.abort(); cancelAnimationFrame(frameId); clear(); controls.dispose(); renderer.dispose(); sphere.dispose(); summary.remove(); },
  };
}
