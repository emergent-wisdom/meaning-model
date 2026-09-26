// The one view of a Meaning Model run. By default it is the processes view as it showed The Rabbit Hole: every named
// process the agent modeled as a curtain of light on its own scale over the story's years, the events that move them as
// threads, the decisions the model drew, the love-or-fear split behind the acts, the causal links between events and the
// agent's thoughts behind them, slowly turning. The Display panel adds the rest, and the URL keeps every choice: the
// camera spinning, free or locked; the glare full or toned down; the story's years or the model's construction played;
// time zoomed from a single day to the model's deep past; the tree of Events and processes Together or in Layers, down
// to a depth; and each kind of record, lens by lens.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadData, fillLinks, linksOf, processLabel, holderText, appendLegendNames } from './common.js';
import { partsAtTime, measureStoryUnits } from './story-time.js';
import { appendDocumentSpans } from './document-spans.js';

const params = new URLSearchParams(location.search);
const { name: dataName, data } = await loadData(params);
// Earlier exports guessed passage dates from word similarity. Re-extract to obtain declared links;
// those old guesses must not be presented as authored world time by this version of the viewer.
if (data.story) data.story.units = data.story.units.map((unit) => unit.timing ? unit
  : { ...unit, t: null, end: null, tells: [], spans: [], timing: 'unlinked' });
const HUES = ['#3987e5', '#d95926', '#199e70']; const WORLD = '#9085e9';
const KIND = { causes: '#ff8a4c', enables: '#3fd3c0', realizes_forecast: '#b793ff', constrains: '#ff4d6d' };
const LENGTH = 116; const AMP = 5.6; const ROW = 2.7; const GAP = 4.4; const NX = 400;
const clip = (text, n) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const words = (text, n) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const cut = s.slice(0, n - 1); const space = cut.lastIndexOf(' '); return `${(space > n * 0.55 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}…`; };
const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
const COLORS = new Map(); const color = (hex) => { let c = COLORS.get(hex); if (!c) { c = new THREE.Color(hex); COLORS.set(hex, c); } return c; }; // shared: clone before changing one

// ---- what the view shows: the URL's choices, each defaulting to the processes view as it was ---------------------------------
const DEFAULT_SHOW = ['processes', 'threads', 'decisions', 'lovefear', 'causal', 'notes'];
const ALL_SHOW = [...DEFAULT_SHOW, 'events', 'subsidiary', 'prose'];
const opt = {
  camera: ['spin', 'free', 'locked'].includes(params.get('camera')) ? params.get('camera') : params.has('still') ? 'free' : 'spin',
  glare: params.get('glare') === 'soft' ? 'soft' : 'full',
  edges: params.get('edges') !== 'off', // the lines that link one thing to another
  mode: params.get('mode') === 'construction' && data.constructionTiming !== 'unavailable' ? 'construction' : 'story',
  speed: [0.25, 0.5, 1, 2, 4].includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 1,
  layout: ({ layers: 'layers', tree: 'layers', terrain: 'terrain' })[params.get('view')] ?? 'together',
  depth: Number.isFinite(Number(params.get('depth'))) && params.has('depth') ? Number(params.get('depth')) : 2,
  show: new Set(params.has('everything') ? ALL_SHOW : params.has('show') ? params.get('show').split(',').filter(Boolean) : DEFAULT_SHOW.filter((key) => !(key === 'notes' && params.has('nothoughts')))),
  lenses: new Set(),
};
let selectedPart = null; const selectedEventIds = new Set(); let selectedLinks = [];
let ready = false; // the panel and the URL follow the view once it has started
let dirty = true; let relayout = true; let extrasDirty = true; let currentTicks = []; // what to redraw
let pointerAt = null; let lit = null; let litNode = null; let litReading = null; let litUnit = null; let litArc = null; let litChain = new Set(); // what the pointer is on

// ---- the rows: every measure with a path, grouped by whose it is -------------------------------------------------------
// A process's name is the run's own (display.names in its viewer.json), else its id as words; display.order sets the rows.
const NAMES = new Proxy({}, { get: (_, id) => processLabel(data, id) });
const principals = data.people.filter((person) => person.principal).sort((a, b) => a.order - b.order);
const first = (person) => person.name.split(' ')[0].toLowerCase();
const ownerOf = (measure) => principals.find((person) => measure.id.split('.')[0] === first(person) || measure.frame === `person:${first(person)}`) ?? null;
const order = data.display?.order ?? Object.keys(data.display?.names ?? {});
const measures = data.measures.filter((measure) => measure.points.length >= 2)
  .sort((a, b) => ((order.indexOf(a.id) + 1) || 99) - ((order.indexOf(b.id) + 1) || 99));
const groups = [...principals.map((person, i) => ({ id: person.id, label: person.name, hue: HUES[i % HUES.length], rows: measures.filter((m) => ownerOf(m) === person) })),
  { id: 'world', label: 'The world', hue: WORLD, rows: measures.filter((m) => !ownerOf(m)) }].filter((group) => group.rows.length);
const times = measures.flatMap((m) => m.points.map((p) => p.t));
// From a little before the story's own years (display.from, else the window its prose and moments span) to its last value.
const storyStart = (data.storyWindow ?? data.window)?.start;
const from = Number.isFinite(data.display?.from) ? data.display.from : Number.isFinite(storyStart) ? storyStart - 0.4 : -Infinity;
const T0 = Math.max(Math.min(...times), from); const T1 = Math.max(...times) + 0.12;
const rows = []; let z = 0;
for (const group of groups) { for (const measure of group.rows) { rows.push({ measure, group, z }); z += ROW; } z += GAP - ROW; }
const depth = z - GAP; for (const row of rows) row.z -= depth / 2;
// Where each row stands in Together (zT, yT) and in Layers (zL, yL), and how far its curtain has risen: always fully in
// the story's years, and as the agent made it in the construction.
for (const row of rows) { row.zT = row.z; row.yT = 0; row.rise = 1; row.riseTo = 1; }
const zFront = Math.max(...rows.map((row) => row.z)); const zBack = Math.min(...rows.map((row) => row.z));
const rowOf = new Map(rows.map((row) => [row.measure.id, row]));

// Display values: linear between the parsed samples, held before the first and after the last. Each row on its own scale.
const valueAt = (points, t) => {
  if (t <= points[0].t) return points[0].v; if (t >= points.at(-1).t) return points.at(-1).v;
  const k = points.findIndex((p) => p.t > t); const a = points[k - 1]; const b = points[k]; return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
};
const measurePosition = (points, t) => {
  if (t < points[0].t) return { label: 'Held before the first sample', samples: [points[0]] };
  if (t > points.at(-1).t) return { label: 'Held after the last sample', samples: [points.at(-1)] };
  const exact = points.find((point) => point.t === t);
  if (exact) return { label: 'At a display sample', samples: [exact] };
  const next = points.findIndex((point) => point.t > t);
  return { label: 'Linearly interpolated between samples', samples: [points[next - 1], points[next]] };
};
for (const row of rows) {
  const values = row.measure.points.map((p) => p.v); const unit = String(row.measure.unit ?? '');
  const hi = Math.max(...values); const lo = Math.min(...values);
  row.range = /0-10/.test(unit) ? [0, 10] : /0-1|share/.test(unit) ? [0, Math.max(1, hi)] : [Math.min(0, lo), hi];
  row.height = (t) => { const v = valueAt(row.measure.points, t); return ((v - row.range[0]) / (row.range[1] - row.range[0] || 1)) * AMP; };
  // A curtain spans the story's years, and its own path where that reaches beyond them.
  row.domain = [Math.min(T0, row.measure.points[0].t), Math.max(T1, row.measure.points.at(-1).t)];
}
const money = (v, sign) => `${sign}${v >= 100 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(2)}`;
const format = (row, v) => {
  const unit = String(row.measure.unit ?? '');
  if (/GBP/.test(unit)) return money(v, '£'); if (/USD/.test(unit)) return money(v, '$');
  if (/hours/.test(unit)) return `${v.toFixed(1)} h`; if (/0-10/.test(unit)) return `${v.toFixed(1)} of 10`;
  if (/share of normal/.test(unit)) return `${Math.round(v * 100)}%`; if (/0-1|share/.test(unit)) return v.toFixed(2);
  return v.toLocaleString('en-GB', { maximumSignificantDigits: 6 });
};
function measureValueLines(row, t) {
  const position = measurePosition(row.measure.points, t);
  const lines = [['num', format(row, valueAt(row.measure.points, t))], ['a', position.label]];
  for (const point of position.samples) {
    const origin = point.valueSource === 'range_midpoint' ? 'Source range midpoint'
      : point.valueSource === 'inferred_zero' ? 'Zero inferred from the source wording'
        : point.valueSource === 'parsed' ? 'Parsed value' : 'Display sample; source detail unavailable';
    const date = point.dateSource === 'inferred' ? ' · date inferred' : point.dateSource === 'parsed' ? ' · date positioned from source wording' : '';
    lines.push(['a', `${origin}: ${format(row, point.v)} at ${month(point.t)}${date}`]);
  }
  for (const text of new Set(position.samples.map((point) => point.text).filter(Boolean))) lines.push(['a', `Source: “${text}”`]);
  return lines;
}

// ---- time: an axis from a moment to deep time ----------------------------------------------------------------------------
// A view is a window [a, b] of years, by default the story's. Its mapping to the screen blends a linear scale with a log
// scale of years before the present, by how wide the window is: linear across a few centuries, logarithmic across
// millennia.
const reachOf = (event) => (Array.isArray(event.reach) ? event.reach : [event.start, event.end ?? event.start]);
const allReach = data.events.map(reachOf).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
const PRESENT = Math.max(data.extent?.end ?? T1, T1, ...allReach.map(([, b]) => b));
const EARLIEST = Math.min(data.extent?.start ?? T0, T0, ...allReach.map(([a]) => a));
const KNEE = 3; const BOUNDS = [EARLIEST - (PRESENT - EARLIEST) * 0.015, Math.max(PRESENT, T1)]; const MIN_SPAN = 0.004;
const G = (t) => -Math.log(KNEE + BOUNDS[1] - Math.min(t, BOUNDS[1] + KNEE * 0.999));
const Ginv = (g) => BOUNDS[1] + KNEE - Math.exp(-g);
const warpOf = (span) => smooth((Math.log10(span) - 2.45) / 1.15);
const frameOf = (a, b) => ({ a, b, s: b - a, w: warpOf(b - a), ga: G(a), gb: G(b) });
const fracOf = (V, t) => (1 - V.w) * ((t - V.a) / V.s) + (V.w ? V.w * ((G(t) - V.ga) / (V.gb - V.ga)) : 0);
function timeAt(V, u) { if (!V.w) return V.a + u * V.s; let lo = V.a - V.s * 4; let hi = Math.min(V.b + V.s * 4, BOUNDS[1] + KNEE * 0.99); for (let i = 0; i < 64; i += 1) { const mid = (lo + hi) / 2; if (fracOf(V, mid) < u) lo = mid; else hi = mid; } return (lo + hi) / 2; }
// The window of a given width that keeps time t at screen fraction u.
function windowAt(t, u, span) {
  span = Math.max(MIN_SPAN, Math.min(span, BOUNDS[1] - BOUNDS[0]));
  let lo = t - span; let hi = t;
  for (let i = 0; i < 64; i += 1) { const mid = (lo + hi) / 2; if (fracOf(frameOf(mid, mid + span), t) > u) lo = mid; else hi = mid; }
  const a = Math.max(BOUNDS[0], Math.min((lo + hi) / 2, BOUNDS[1] - span)); return [a, a + span];
}
let F = frameOf(T0, T1);
const isStory = () => Math.abs(F.a - T0) < 1e-9 && Math.abs(F.b - T1) < 1e-9;
const X = (t) => { const x = (fracOf(F, t) - 0.5) * LENGTH; return x < -3 * LENGTH ? -3 * LENGTH : x > 3 * LENGTH ? 3 * LENGTH : x; };
const xOf = (t) => X(Math.max(F.a, Math.min(F.b, t)));
// The time at each screen fraction, tabulated once per view for a curved axis.
let table = null;
function tabulate() { if (!F.w) { table = null; return; } const n = 720; const ts = new Float64Array(n + 1); for (let i = 0; i <= n; i += 1) ts[i] = timeAt(F, -0.05 + (1.1 * i) / n); table = { n, ts }; }
const timeAtX = (x) => { const u = x / LENGTH + 0.5; if (!table) return F.a + u * F.s; const k = ((u + 0.05) / 1.1) * table.n; const i = Math.max(0, Math.min(table.n - 1, Math.floor(k))); return table.ts[i] + (table.ts[i + 1] - table.ts[i]) * (k - i); };
const inView = (t, early = 0) => Number.isFinite(t) && t >= F.a - early && t <= F.b;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (t) => { const year = Math.floor(t); return new Date(Date.UTC(year, 0, 1) + (t - year) * 365.2425 * 86400000); };
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const yearText = (year) => (year < 0 ? `${grouped(-year)} BCE` : year === 0 ? '1 CE' : `${year}`);
function timeText(t, span = F.s) {
  if (PRESENT - t >= 5000) { const ago = PRESENT - t; const round = ago >= 100000 ? 10000 : ago >= 20000 ? 1000 : 100; return `${grouped(Math.round(ago / round) * round)} years ago`; }
  if (span > 30 || t < 1) return yearText(Math.round(t));
  const d = dateOf(t); if (span > 1.5) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const spanText = (a, b) => { const years = b - a; if (years >= 2) return `${grouped(years)} years`; if (years >= 2 / 12) return `${Math.round(years * 12)} months`; return `${Math.max(1, Math.round(years * 365.2425))} days`; };
// Ticks: at the story's years every year, as the view always showed them; elsewhere coarse ones first and finer ones where
// they fit, so the axis reads at every scale, on a log scale too.
function tickMarks() {
  if (isStory()) { const out = []; for (let year = Math.ceil(T0); year <= Math.floor(T1); year += 1) out.push({ t: year, text: String(year), major: true }); return out; }
  const out = []; const gap = 7; const taken = [];
  const room = (x) => taken.every((other) => Math.abs(other - x) >= gap);
  const legible = (t, before, after) => Math.min(Math.abs(X(t) - X(before)), Math.abs(X(after) - X(t))) >= gap * 0.9;
  const tryAdd = (t, text, major, before, after) => { if (!(t >= F.a && t <= F.b)) return; const x = X(t); if (!room(x) || !legible(t, before, after)) return; taken.push(x); out.push({ t, text: typeof text === 'function' ? text() : text, major }); };
  const ages = [300000, 100000, 30000, 10000, 5000];
  ages.forEach((age, i) => tryAdd(PRESENT - age, () => `${grouped(age)} years ago`, true, PRESENT - (ages[i - 1] ?? age * 3), PRESENT - (ages[i + 1] ?? age / 3)));
  for (const step of [1000, 500, 100, 50, 10, 5, 1]) { const start = Math.ceil(Math.max(F.a, PRESENT - 5000) / step) * step; for (let year = start; year <= F.b && out.length < 60; year += step) if (year !== 0) tryAdd(year, () => yearText(year), step >= 100, year - step, year + step); }
  if (F.s < 12) for (const every of [6, 3, 1]) for (let year = Math.floor(F.a); year <= Math.ceil(F.b); year += 1) for (let month = 0; month < 12; month += every) {
    const t = year + month / 12; tryAdd(t, () => (month === 0 ? `${year}` : F.s < 2 ? `${MONTHS[month]} ${year}` : MONTHS[month]), month === 0, t - every / 12, t + every / 12);
  }
  if (F.s < 0.4) { const day = 1 / 365.2425; const start = dateOf(F.a); const day0 = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    for (const every of [7, 1]) for (let ms = day0; ms <= day0 + F.s * 365.2425 * 86400000 + 86400000; ms += 86400000) {
      const date = new Date(ms); if (every === 7 && date.getUTCDay() !== 1) continue;
      const t = date.getUTCFullYear() + (ms - Date.UTC(date.getUTCFullYear(), 0, 1)) / (365.2425 * 86400000); tryAdd(t, () => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`, date.getUTCDate() === 1, t - every * day, t + every * day);
    } }
  return out.sort((a, b) => a.t - b.t);
}

// ---- scene --------------------------------------------------------------------------------------------------------------
const host = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); host.append(renderer.domElement);
const labels = new CSS2DRenderer(); labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' }); host.append(labels.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#050608'); scene.fog = new THREE.FogExp2('#050608', 0.0048);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 900);
camera.position.set(-LENGTH * 0.12, 96, zFront + 78);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-2, 0, 5); controls.enableDamping = true; controls.zoomToCursor = true; controls.autoRotate = opt.camera === 'spin'; controls.autoRotateSpeed = 0.3;
const HOME = { position: camera.position.clone(), target: controls.target.clone() };
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
// The glare: full is the bloom the view always had; toned down keeps the light and drops most of the haze.
const GLARE = { full: [0.55, 0.42, 0.2], soft: [0.16, 0.3, 0.42] };
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), ...GLARE[opt.glare]); composer.addPass(bloom); composer.addPass(new OutputPass());
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight); if (opt.camera === 'locked') { fitLocked(); placeLocked(true); } dirty = true; });
const grid = new THREE.GridHelper(LENGTH * 1.4, 56, '#1a2030', '#0e121a'); grid.position.y = -0.02; scene.add(grid);
// The processes and the tree live in one field; the terrain has its own, and the view shows one or the other.
const field = new THREE.Group(); scene.add(field);
const label = (className, text, position, center = [0.5, 0.5], parent = field) => {
  const element = document.createElement('div'); element.className = `label ${className}`; if (text !== null) element.textContent = text;
  const object = new CSS2DObject(element); object.position.copy(position); object.center.set(...center); parent.add(object); return object;
};
const additive = (hex, opacity = 1) => new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const spark = (hex, size) => { const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: hex, transparent: true, opacity: opt.glare === 'soft' ? 0.5 : 1, blending: THREE.AdditiveBlending, depthWrite: false })); sprite.scale.setScalar(size); return sprite; };

// Growable buffers for what the panel adds and for the links the view redraws as it zooms: line segments, triangles and
// glowing points, refilled whenever the view changes.
class Lines {
  constructor(opacity = 1) { this.max = 0; this.geometry = new THREE.BufferGeometry(); this.object = new THREE.LineSegments(this.geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); this.object.frustumCulled = false; field.add(this.object); this.grow(1024); }
  grow(n) { const pos = new Float32Array(n * 6); const col = new Float32Array(n * 8); if (this.pos) { pos.set(this.pos); col.set(this.col); } this.pos = pos; this.col = col; this.max = n; this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.geometry.setAttribute('color', new THREE.BufferAttribute(col, 4)); }
  begin() { this.n = 0; }
  add(x0, y0, z0, x1, y1, z1, c, a0, a1 = a0, c1 = c) { if (this.n >= this.max) this.grow(this.max * 2); const i = this.n * 6; const j = this.n * 8; this.pos[i] = x0; this.pos[i + 1] = y0; this.pos[i + 2] = z0; this.pos[i + 3] = x1; this.pos[i + 4] = y1; this.pos[i + 5] = z1;
    this.col[j] = c.r; this.col[j + 1] = c.g; this.col[j + 2] = c.b; this.col[j + 3] = a0; this.col[j + 4] = c1.r; this.col[j + 5] = c1.g; this.col[j + 6] = c1.b; this.col[j + 7] = a1; this.n += 1; }
  end() { this.geometry.setDrawRange(0, this.n * 2); this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.color.needsUpdate = true; }
}
class Tris {
  constructor(solid = false) { this.max = 0; this.geometry = new THREE.BufferGeometry(); this.object = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: solid ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, depthTest: !solid, side: THREE.DoubleSide })); this.object.frustumCulled = false; if (solid) this.object.renderOrder = 5; field.add(this.object); this.grow(4096); }
  grow(n) { const pos = new Float32Array(n * 3); const col = new Float32Array(n * 4); if (this.pos) { pos.set(this.pos); col.set(this.col); } this.pos = pos; this.col = col; this.max = n; this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.geometry.setAttribute('color', new THREE.BufferAttribute(col, 4)); }
  begin() { this.n = 0; }
  vertex(x, y, zz, c, a) { if (this.n >= this.max) this.grow(this.max * 2); const i = this.n * 3; const j = this.n * 4; this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = zz; this.col[j] = c.r; this.col[j + 1] = c.g; this.col[j + 2] = c.b; this.col[j + 3] = a; this.n += 1; }
  quad(x0, x1, yb0, yt0, yb1, yt1, zz, c, ab, at) { this.vertex(x0, yb0, zz, c, ab); this.vertex(x1, yb1, zz, c, ab); this.vertex(x0, yt0, zz, c, at); this.vertex(x0, yt0, zz, c, at); this.vertex(x1, yb1, zz, c, ab); this.vertex(x1, yt1, zz, c, at); }
  end() { this.geometry.setDrawRange(0, this.n); this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.color.needsUpdate = true; }
}
class Glows {
  constructor() {
    this.max = 0; this.geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { map: { value: glow }, scale: { value: renderer.getPixelRatio() } },
      vertexShader: 'attribute float size; attribute vec4 tint; varying vec4 vTint; uniform float scale; void main() { vTint = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vTint; void main() { float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vTint.rgb, vTint.a * a); }' });
    this.object = new THREE.Points(this.geometry, material); this.object.frustumCulled = false; field.add(this.object); this.grow(1024);
  }
  grow(n) { const pos = new Float32Array(n * 3); const tint = new Float32Array(n * 4); const size = new Float32Array(n); if (this.pos) { pos.set(this.pos); tint.set(this.tint); size.set(this.size); } this.pos = pos; this.tint = tint; this.size = size; this.max = n;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 4)); this.geometry.setAttribute('size', new THREE.BufferAttribute(size, 1)); }
  begin() { this.n = 0; }
  add(x, y, zz, c, a, px) { if (this.n >= this.max) this.grow(this.max * 2); const i = this.n; this.pos.set([x, y, zz], i * 3); this.tint.set([c.r, c.g, c.b, a], i * 4); this.size[i] = px; this.n += 1; }
  end() { this.geometry.setDrawRange(0, this.n); for (const name of ['position', 'tint', 'size']) this.geometry.attributes[name].needsUpdate = true; }
}

// ---- the tree the panel can add: every Event in its place, whose it is, at every depth ----------------------------------------
// The world's Events and each person's inner process; readings and a holder's understanding hang off their records instead.
const WORLDLY = new Set(['accepted_world', 'inner', 'unrooted', undefined]);
const treeEvents = data.events.filter((event) => Array.isArray(event.reach) && event.role !== 'reading' && WORLDLY.has(event.context));
const hasTree = treeEvents.length > 0 && Array.isArray(data.processes);
const byId = new Map(data.events.map((event) => [event.id, event]));
const treeById = new Map(treeEvents.map((event) => [event.id, event]));
const referents = new Map((data.referents ?? []).map((referent) => [referent.id, referent]));
const hueOfOwner = (owner) => { const i = principals.findIndex((person) => person.id === owner); return i >= 0 ? HUES[i % HUES.length] : WORLD; };
const groupKeyOf = (owner) => (principals.some((person) => person.id === owner) ? owner : 'world');
const DATEY = /\b(1\d{3}|20\d{2}|\d{3,6} (years|BC)|January|February|March|April|May|June|July|August|September|October|November|December|spring|summer|autumn|winter|night|evening|morning|week|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|onward|Late|Early|Mid)\b/i;
function eventName(event) {
  if (event.role === 'world') return 'The world';
  if (event.role === 'life') { const who = [...referents.values()].find((referent) => referent.life === event.id); if (who?.person) return `${who.name.split(' ')[0]}'s life`; }
  if (event.role === 'inner') { const who = principals.find((person) => person.id === event.owner); return who ? `${who.name.split(' ')[0]}'s inner life` : 'An inner life'; }
  if (event.role === 'slow') return `${event.id.split('.').at(-1)}`;
  let text = String(event.label ?? event.id).replace(/\s+/g, ' ').trim();
  const head = text.match(/^([^:]{3,70}):\s+(.+)$/); if (head && DATEY.test(head[1])) text = head[2];
  text = text.replace(/\s*\((invented|real[^)]*|[^)]{0,40})\)/g, '');
  const lead = text.match(/^([^:]{8,}?):\s+(.+)$/); if (lead && lead[1].split(' ').length >= 3 && event.depth <= 2) text = lead[1];
  if (event.role === 'phase') text = `${String(event.phase ?? '').replace('_', ' ')}: ${text}`;
  return text.replace(/,? \d{4}\s?[-–]\s?\d{4}\.?$/, '').replace(/\.$/, '');
}
const nodes = [];
if (hasTree) for (const event of treeEvents) {
  event.name = eventName(event); event.children = treeEvents.filter((other) => other.parent === event.id).map((other) => other.id);
  const sub = event.role === 'slow' || event.role === 'phase';
  nodes.push({ kind: sub ? 'sub' : 'event', id: event.id, event, depth: event.depth, owner: event.owner, group: groupKeyOf(event.owner), t0: event.reach[0], t1: event.reach[1], trunk: event.depth <= 1, parent: event.parent });
}
const nodeById = new Map(nodes.map((node) => [node.id, node]));
// A row's place in the tree: its process's depth (one below the Event it belongs to) and its home.
const processById = new Map((data.processes ?? []).map((process) => [process.id, process]));
for (const row of rows) { const process = processById.get(row.measure.id); row.depth = process?.depth ?? 1; row.home = process?.home ?? null; }
const MAX_DEPTH = hasTree ? Math.max(...nodes.map((node) => node.depth), ...rows.map((row) => row.depth)) : 0;
opt.depth = params.has('everything') ? MAX_DEPTH : Math.max(0, Math.min(MAX_DEPTH, opt.depth));
const lensList = (data.lenses ?? []).filter((lens) => lens.readings.length);
const ANSWER = ['#ffb057', '#58b4ff', '#5fd39a', '#c69bff', '#ff7aa8', '#e8e27a', '#7fe0e6']; const REMAINDER = '#4a4945';
for (const lens of lensList) {
  const keys = lens.answers?.map((answer) => answer.key) ?? (lens.id === 'fear-love' ? ['fear', 'love'] : [...new Set(lens.readings.flatMap((reading) => reading.answers.map((answer) => answer.key)).filter((key) => key !== 'remainder'))].sort());
  lens.palette = new Map(keys.map((key, i) => [key, ANSWER[i % ANSWER.length]]));
  if (lens.id === 'fear-love') { lens.palette.set('love', '#ffb057'); lens.palette.set('fear', '#58b4ff'); }
  lens.keyOf = (key) => (lens.palette.has(key) ? key : lens.id === 'fear-love' ? (/^love/.test(key) ? 'love' : /^fear/.test(key) ? 'fear' : 'remainder') : key);
  lens.colorOf = (key) => lens.palette.get(lens.keyOf(key)) ?? REMAINDER;
}
if (params.has('lenses') || params.has('everything')) opt.lenses = new Set(params.has('everything') || params.get('lenses') === 'all' ? lensList.map((lens) => lens.id) : params.get('lenses').split(',').filter(Boolean));
const prose = (data.story?.units ?? []).filter((unit) => Number.isFinite(unit.t));
const bornAt = (item) => (item?.born?.at ? Date.parse(item.born.at) : -Infinity);

// ---- layout: Together is the processes view's field; Layers stacks the tree level by level ----------------------------------
// Together keeps the rows where they always were; Events the panel adds get lanes in front of their group's rows. Layers are
// terraces: each level of the tree a floor, lower than the one above it and nearer the viewer, the processes at their level
// and the Events packed into lanes by time.
const LANE = 1.0; const LAMP = 3.2; const MIN_DUR = 0.02;
const blend = { now: opt.layout === 'layers' ? 1 : 0, to: opt.layout === 'layers' ? 1 : 0 };
const visibleNode = (node, layers) => {
  if (node.depth > opt.depth) return false;
  if (node.kind === 'sub') return opt.show.has('subsidiary');
  return (node.trunk && layers) || opt.show.has('events');
};
function pack(items) {
  const ends = [];
  for (const item of items.sort((a, b) => a.t0 - b.t0 || (b.t1 - b.t0) - (a.t1 - a.t0))) {
    let lane = ends.findIndex((end) => end <= item.t0); if (lane < 0) { lane = ends.length; ends.push(-Infinity); }
    ends[lane] = Math.max(item.t1, item.t0 + MIN_DUR); item.lane = lane;
  }
  return ends.length;
}
let floors = []; let layersBounds = null;
function computeLayout() {
  for (const node of nodes) { node.inT = visibleNode(node, false); node.inL = visibleNode(node, true); node.shown = node.inT || node.inL; }
  // Together: the rows as they always were, and beneath each group's curtains the Events and subsidiary processes of its
  // tree, one floor further down for each level, spread across the group's rows.
  let zz = 0; const spans = [];
  for (const group of groups) { const z0 = zz; for (const row of rows.filter((item) => item.group === group)) { row.zT = zz; zz += ROW; } spans.push({ group, z0, z1: zz - ROW }); zz += GAP - ROW; }
  const spanT = zz - GAP; for (const row of rows) row.zT -= spanT / 2;
  for (const { group, z0, z1 } of spans) {
    const mine = nodes.filter((node) => node.inT && (node.group === group.id || (group.id === 'world' && !groups.some((other) => other.id === node.group))));
    for (const level of [...new Set(mine.map((node) => node.depth))].sort((a, b) => a - b)) {
      const here = mine.filter((node) => node.depth === level); const lanes = pack(here); const width = Math.max(ROW, z1 - z0);
      for (const node of here) { node.yT = -1.6 * Math.max(1, level); node.zT = z0 - spanT / 2 + (lanes > 1 ? (node.lane / (lanes - 1)) * width : width / 2); }
    }
  }
  // Layers: floors of the tree.
  floors = []; let y = 0; zz = 0;
  for (let level = 0; level <= opt.depth; level += 1) {
    const here = [...nodes.filter((node) => node.inL && node.depth === level), ...(opt.show.has('processes') ? rows.filter((row) => row.depth === level) : [])];
    if (!here.length) continue;
    const amp = here.some((item) => item.measure) ? LAMP : 0;
    if (floors.length) { y -= 2.6 + amp * 0.5; zz += 2.6 + amp * 0.55; }
    const z0 = zz;
    for (const group of [...groups, { id: 'world' }].filter((item, i, all) => all.findIndex((other) => other.id === item.id) === i)) {
      const mine = here.filter((item) => (item.measure ? item.group.id : item.group) === group.id); if (!mine.length) continue;
      for (const row of mine.filter((item) => item.measure)) { row.zL = zz + ROW * 0.55; row.yL = y; zz += ROW * 0.9; }
      const rest = mine.filter((item) => !item.measure); const lanes = pack(rest); for (const node of rest) { node.zL = zz + node.lane * LANE + LANE * 0.5; node.yL = y; }
      zz += lanes * LANE + 1.4;
    }
    floors.push({ level, y, z0, z1: zz, roles: here, amp });
  }
  // Rows or Events in one representation only fade where they stand in it.
  for (const row of rows) { if (row.zL === undefined || !(opt.show.has('processes') && row.depth <= opt.depth)) { row.inL = false; row.zL = row.zT; row.yL = row.yT; } else row.inL = true; }
  const zs = floors.flatMap((floor) => [floor.z0, floor.z1]); const ys = floors.map((floor) => floor.y);
  layersBounds = floors.length ? { z0: Math.min(...zs), z1: Math.max(...zs), y0: Math.min(...ys), y1: Math.max(...ys) } : null;
  // Centre the floors on the field.
  if (layersBounds) { const dz = (layersBounds.z0 + layersBounds.z1) / 2; const dy = (layersBounds.y0 + layersBounds.y1) / 2 - 0;
    for (const row of rows) if (row.inL) { row.zL -= dz; row.yL -= dy; } for (const node of nodes) if (node.inL) { node.zL -= dz; node.yL -= dy; }
    for (const floor of floors) { floor.z0 -= dz; floor.z1 -= dz; floor.y -= dy; }
    layersBounds = { z0: layersBounds.z0 - dz, z1: layersBounds.z1 - dz, y0: layersBounds.y0 - dy, y1: layersBounds.y1 - dy };
  }
  // An Event in one representation only comes and goes where it stands in that one.
  for (const node of nodes) { if (node.inL && !node.inT) { node.yT = node.yL; node.zT = node.zL; } if (node.inT && !node.inL) { node.yL = node.yT; node.zL = node.zT; } }
  if (opt.camera === 'locked') fitLocked();
  dirty = true; relayout = true;
}
// Where a row or node stands now: blended between Together and Layers.
const rowAt = (row) => { const m = smooth(blend.now); return { y: row.yT + ((row.yL ?? row.yT) - row.yT) * m, z: row.zT + ((row.zL ?? row.zT) - row.zT) * m }; };
const presence = (item) => { const m = smooth(blend.now); return (1 - m) * (item.inT === false ? 0 : 1) + m * (item.inL ? 1 : 0); };
const frontOf = (rowsOf) => rowsOf.reduce((a, b) => (rowAt(b).z > rowAt(a).z ? b : a));

// ---- the processes: curtains of light, each on its own scale ------------------------------------------------------------------
// Each process a wall of light, bright at its value, fading to the ground.
for (const row of rows) {
  const c = new THREE.Color(row.group.hue);
  const positions = new Float32Array(NX * 2 * 3); const colors = new Float32Array(NX * 2 * 4); const index = [];
  for (let i = 0; i < NX; i += 1) { colors.set([c.r, c.g, c.b, 0.0, c.r, c.g, c.b, 0.3], i * 8); if (i) index.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, i * 2, (i - 1) * 2 + 1, i * 2 + 1); }
  const wall = new THREE.BufferGeometry(); wall.setAttribute('position', new THREE.BufferAttribute(positions, 3)); wall.setAttribute('color', new THREE.BufferAttribute(colors, 4)); wall.setIndex(index);
  row.wall = new THREE.Mesh(wall, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const line = new THREE.BufferGeometry(); line.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NX * 3), 3));
  row.crest = new THREE.Line(line, additive(c.clone().lerp(new THREE.Color('#ffffff'), 0.35), 1));
  row.wall.frustumCulled = false; row.crest.frustumCulled = false; row.sampleT = new Float64Array(NX);
  field.add(row.wall, row.crest);
  const name = label('row', NAMES[row.measure.id] ?? row.measure.id.split('.').slice(-1)[0].replace(/_/g, ' '), new THREE.Vector3(-LENGTH / 2 - 1.2, 0.8, row.z), [1, 0.5]);
  name.element.title = `${row.measure.role ?? ''}\n\n${row.measure.support}`.trim(); name.element.style.color = `color-mix(in srgb, ${row.group.hue} 45%, #ffffff)`;
  row.name = name; row.value = label('value', '', new THREE.Vector3(LENGTH / 2 + 1.2, 0.8, row.z), [0, 0.5]);
}
// Lay a curtain over the window: samples evenly across the screen, over the years the curtain spans.
function layRow(row) {
  const p = rowAt(row); const vis = presence(row) * (opt.show.has('processes') ? 1 : 0);
  const d0 = Math.max(F.a, row.domain[0]); const d1 = Math.min(F.b, row.domain[1]);
  const shown = vis > 0.01 && d1 > d0; row.wall.visible = shown; row.crest.visible = shown;
  row.name.visible = vis > 0.5; row.value.visible = vis > 0.5;
  row.name.position.set(-LENGTH / 2 - 1.2, p.y + 0.8, p.z); row.value.position.set(LENGTH / 2 + 1.2, p.y + 0.8, p.z);
  row.wall.material.opacity = vis; row.crest.material.opacity = vis;
  if (!shown) return;
  const x0 = X(d0); const x1 = X(d1); const amp = 1 - smooth(blend.now) * (1 - LAMP / AMP);
  const positions = row.wall.geometry.attributes.position.array; const crest = row.crest.geometry.attributes.position.array;
  for (let i = 0; i < NX; i += 1) {
    const x = x0 + ((x1 - x0) * i) / (NX - 1); const t = F.w ? timeAtX(x) : d0 + ((d1 - d0) * i) / (NX - 1); const h = row.height(t) * amp * row.rise;
    row.sampleT[i] = t; positions.set([x, p.y, p.z, x, p.y + h, p.z], i * 6); crest.set([x, p.y + h + 0.02, p.z], i * 3);
  }
  row.wall.geometry.attributes.position.needsUpdate = true; row.crest.geometry.attributes.position.needsUpdate = true;
  row.wall.geometry.computeBoundingSphere(); row.crest.geometry.computeBoundingSphere();
}
// The height of a row's curtain at a time, as drawn now.
const heightAt = (row, t) => row.height(t) * (1 - smooth(blend.now) * (1 - LAMP / AMP)) * row.rise;
const groupLabels = [];
for (const group of groups) {
  const object = label('group', group.label, new THREE.Vector3(-LENGTH / 2 - 1.2, 0.3, 0), [1, 0.5]); object.element.style.color = group.hue; groupLabels.push({ group, object });
}
// The time axis along the front: labels and faint lines across the field, from a pool.
const tickPool = [];
for (let i = 0; i < 48; i += 1) {
  const object = label('year', '', new THREE.Vector3(0, 0, 0)); const lineGeometry = new THREE.BufferGeometry(); lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(lineGeometry, additive('#2a3246', 0.8)); line.frustumCulled = false; scene.add(line); tickPool.push({ object, line });
}

// Events that move processes: a thread through the crests they touch, at the moment they begin.
const threads = []; const eventSparks = [];
for (const event of data.events) {
  const touched = (event.processIds ?? []).map((id) => rowOf.get(id)).filter(Boolean).sort((a, b) => a.z - b.z);
  if (!touched.length || !Number.isFinite(event.start)) continue;
  const group = new THREE.Group(); group.userData = { t: event.start, event, touched, lines: [], sparks: [] };
  for (const row of touched) {
    const stem = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), additive('#ffffff', 0.35)); stem.frustumCulled = false; group.add(stem); group.userData.lines.push(stem);
    const s = spark('#ffffff', 1.5); s.userData.hover = { kind: 'Event', title: event.label, text: event.description, about: touched.map((item) => NAMES[item.measure.id] ?? item.measure.id),
      values: touched.map((item) => `${NAMES[item.measure.id] ?? item.measure.id}: ${format(item, valueAt(item.measure.points, event.start))} · ${measurePosition(item.measure.points, event.start).label}`) }; group.add(s); eventSparks.push(s); group.userData.sparks.push(s);
  }
  if (touched.length > 1) { const link = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(touched.length * 3), 3)), additive('#fff3d6', 0.9)); link.frustumCulled = false; group.add(link); group.userData.link = link; }
  field.add(group); threads.push(group);
  if (touched.length >= 2) { const tag = label('event', clip(event.label, 70), new THREE.Vector3(0, 0, 0), [0.5, 1], group); tag.userData = { t: event.start, weight: touched.length }; group.userData.tag = tag; }
}
// A thread's stems, sparks and link at the time it is drawn (its start, or the window's edge a little after it).
function layThread(group) {
  const t = Math.max(group.userData.t, F.a); group.position.x = X(t); group.userData.tDrawn = t;
  const ordered = [...group.userData.touched].sort((a, b) => rowAt(a).z - rowAt(b).z); const tops = [];
  group.userData.touched.forEach((row, i) => {
    const p = rowAt(row); const top = new THREE.Vector3(0, p.y + heightAt(row, t) + 0.05, p.z);
    const stem = group.userData.lines[i].geometry.attributes.position; stem.array.set([0, p.y, p.z, top.x, top.y, top.z]); stem.needsUpdate = true; group.userData.lines[i].geometry.computeBoundingSphere();
    group.userData.sparks[i].position.copy(top);
  });
  for (const row of ordered) { const p = rowAt(row); tops.push(new THREE.Vector3(0, p.y + heightAt(row, t) + 0.05, p.z)); }
  if (group.userData.link) { const attr = group.userData.link.geometry.attributes.position; tops.forEach((top, i) => attr.array.set([top.x, top.y, top.z], i * 3)); attr.needsUpdate = true; group.userData.link.geometry.computeBoundingSphere(); }
  if (group.userData.tag) { const high = tops.reduce((a, b) => (b.y > a.y ? b : a)); group.userData.tag.position.set(0, high.y + 1.3, high.z); group.userData.tag.userData.t = t; }
}

// Decisions the model drew, and the love-or-fear split behind the acts, on each person's front row.
const decisions = []; const lenses = [];
principals.forEach((person) => {
  const own = rows.filter((row) => ownerOf(row.measure) === person); if (!own.length) return;
  const hue = HUES[principals.indexOf(person) % HUES.length];
  for (const decision of person.decisions) {
    if (!Number.isFinite(decision.t)) continue;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: decision.drawn ? '#ffffff' : hue }));
    gem.userData = { t: decision.t, own, lift: 2.2, decision, person }; field.add(gem); decisions.push(gem);
    const answers = (decision.answers ?? []).slice(0, 6).map((answer) => `${Math.round(answer.weight * 100)}% ${answer.key.replace(/[_.-]+/g, ' ')}${decision.drawn?.realized === answer.key ? ' (drawn)' : ''}`).join(' · ');
    gem.userData.hover = { kind: `A decision · ${person.name}${decision.drawn ? ' · drawn by the model' : ''}`, title: decision.question ?? decision.label ?? 'A decision', text: answers, about: [timeText(decision.t, 2)] };
    const halo = spark(hue, 3.2); gem.add(halo); halo.position.set(0, 0, 0);
  }
  for (const series of person.series.filter((item) => /love or (of )?fear/i.test(item.question))) {
    const point = series.points[0]; if (!point || !Number.isFinite(point.t)) continue;
    const shared = lenses.find((lens) => lens.userData.cutId === point.cutId); if (shared) { shared.userData.names.push(person.name.split(' ')[0]); shared.element.querySelector('.act').textContent = `${shared.userData.names.join(' and ')}: ${shared.userData.act}`; continue; }
    const share = (pattern) => point.answers.filter((answer) => pattern.test(answer.key)).reduce((sum, answer) => sum + answer.weight, 0);
    const love = share(/^love/); const fear = share(/^fear/); const rest = Math.max(0, 1 - love - fear);
    const act = (series.question.match(/^Is (.+?) an act of/i)?.[1] ?? series.question).replace(/^(\w)/, (c) => c.toUpperCase());
    const element = document.createElement('div'); element.className = 'label lens-host';
    element.innerHTML = `<div class="lens"><div class="act"></div><div class="split"><i class="love" style="width:${love * 100}%"></i><i class="fear" style="width:${fear * 100}%"></i><i class="rest" style="width:${rest * 100}%"></i></div><div class="words"><span><b>love</b> ${Math.round(love * 100)}%</span><span><b>fear</b> ${Math.round(fear * 100)}%</span></div></div>`;
    element.querySelector('.act').textContent = `${person.name.split(' ')[0]}: ${act}`;
    // A weight is never shown alone: the question, the unit, every answer with the remainder, the moment and whose it is.
    const at = data.events.find((event) => event.id === point.eventId);
    element.title = [series.question, series.unit, ...point.answers.map((answer) => `${answer.key.replace(/_/g, ' ')}: ${Math.round(answer.weight * 100)}%`),
      at ? `At: ${at.label}` : null, `Whose: ${holderText({ holder: null })}`].filter(Boolean).join('\n');
    const object = new CSS2DObject(element); object.center.set(0.5, 1); object.userData = { t: point.t, cutId: point.cutId, act, names: [person.name.split(' ')[0]], own, lift: 4.2, born: point.born }; field.add(object); lenses.push(object);
    element.addEventListener('click', () => { const [question, unit, ...rest] = element.title.split('\n'); showDetails([tipLine('k', 'Love or fear'), tipLine('v', element.querySelector('.act').textContent), element.querySelector('.split').cloneNode(true), tipLine('m', question), ...rest.map((line) => tipLine('a', line)), tipLine('a', unit)]); });
  }
});
function layOnFront(item) {
  const { own, lift, t } = item.userData; const front = frontOf(own); const p = rowAt(front);
  const top = Math.max(...own.map((row) => heightAt(row, t)));
  item.position.set(xOf(t), p.y + top + lift, p.z + 0.8);
}

// The agent's thoughts: every note in the story graph (thoughts, author records, draws, world stages, references) and the
// prose passages, as a layer of light behind the processes, never in front of them. A note sits at the moments it is
// about, else beside the notes it links to, else in the order the agent made it; the graph's links run between them.
// Hover any light to read it.
const tip = document.getElementById('tip');
const NOTE = { root: ['Document', '#ffe6ae', 6], thought: ['Thought', '#c9d4ff', 0], author: ['Author record', '#ffd49a', 1], draw: ['Draw', '#ffffff', 2], world: ['World stage', '#b9aefc', 3], reference: ['Model reference', '#8fe3c9', 4], director: ['Director', '#ffb3c7', 2], review: ['Review', '#ffe08a', 1], passage: ['Prose', '#fff0d0', 5] };
const hoverable = []; const notes = []; const mind = new THREE.Group(); mind.visible = opt.show.has('notes'); field.add(mind);
const mindLines = new Lines(); const noteLinks = new Lines(); field.remove(mindLines.object, noteLinks.object); mind.add(mindLines.object, noteLinks.object);
const graphNodes = data.graph.nodes;
const neighbours = new Map(); const moments = new Map();
for (const edge of data.graph.edges) {
  if (edge.target.node) { for (const [a, b] of [[edge.source, edge.target.node], [edge.target.node, edge.source]]) push(neighbours, a, b); }
  const event = byId.get(edge.target.event); if (event && Number.isFinite(event.start)) push(moments, edge.source, event);
}
const noteLayer = (node) => NOTE[node.category]?.[2] ?? 2;
// Where each document of the graph is attached: the moments, people, processes, Cuts and concepts it is about.
const cutQuestion = new Map(); for (const person of data.people) { for (const series of person.series ?? []) for (const point of series.points) if (point.cutId) cutQuestion.set(point.cutId, series.question); for (const decision of person.decisions ?? []) if (decision.cutId) cutQuestion.set(decision.cutId, decision.question); }
const TYPE_WORDS = { 'understanding.report': 'Report', 'understanding.plan': 'Plan', 'understanding.decision': 'Decision', 'storytelling.selection': 'Selection', 'storytelling.candidate': 'Candidate', 'storytelling.idea': 'Idea', 'storytelling.context': 'Context', 'storytelling.author_model': 'Author model', 'storytelling.world': 'World stage', 'storytelling.decision': 'Story decision', model_reference: 'Model reference', direction_draw: 'Drawn decision', story_part: 'Part of the story' };
function attachmentsOf(node) {
  const out = []; const seen2 = new Set();
  for (const edge of data.graph.edges) {
    if (edge.source !== node.id || !edge.target.anchor) continue; const key = `${edge.target.anchorKind}:${edge.target.anchor}`; if (seen2.has(key)) continue; seen2.add(key);
    const kind = edge.target.anchorKind; const id = edge.target.anchor;
    const text = kind === 'event' ? byId.get(id)?.label : kind === 'referent' ? referents.get(id)?.name ?? data.people.find((person) => person.id === id)?.name : kind === 'process' ? NAMES[id]
      : kind === 'normalized_cut' ? cutQuestion.get(id) ?? byId.get(edge.target.event)?.label : String(id).split('.').at(-1).replace(/_/g, ' ');
    out.push({ kind, id, event: edge.target.event ?? null, text: clip(text ?? id, 70) });
  }
  return out;
}
const ATTACH_WORDS = { event: 'moments', referent: 'people', process: 'processes', normalized_cut: 'Cuts', concept: 'concepts', abstract_cut: 'Cuts', event_relation: 'links' };
const attachmentText = (list) => Object.entries(list.reduce((groups, item) => { (groups[item.kind] ??= []).push(item.text); return groups; }, {}))
  .map(([kind, texts]) => `${texts.length} ${ATTACH_WORDS[kind] ?? kind}: ${texts.slice(0, 4).join(' · ')}${texts.length > 4 ? ' …' : ''}`);
for (const node of graphNodes) {
  const [kind, hex] = NOTE[node.category] ?? ['Note', '#dddddd'];
  const light = spark(hex, node.category === 'passage' ? 2.6 : 2.0); const attached = attachmentsOf(node);
  light.userData = { node, color: color(hex), attached, hover: { kind: [kind, TYPE_WORDS[node.type]].filter((word, i, all) => word && all.indexOf(word) === i).join(' · '), title: node.title, text: node.text, attached: attachmentText(attached) }, id: node.id, born: node.born };
  mind.add(light); notes.push(light); hoverable.push(light);
}
const noteById = new Map(notes.map((light) => [light.userData.id, light]));
const selectedDocumentLabel = label('selected-document', '', new THREE.Vector3(), [0.5, 1], mind); selectedDocumentLabel.visible = false;
const noteEdges = []; { const seen = new Set(); for (const edge of data.graph.edges) { if (!edge.target.node) continue; const key = [edge.source, edge.target.node].sort().join('|'); if (seen.has(key) || !noteById.has(edge.source) || !noteById.has(edge.target.node)) continue; seen.add(key); noteEdges.push([edge.source, edge.target.node]); } }
// Where the moments a note is about meet the processes.
const meet = (event) => {
  const t = Math.max(F.a, Math.min(F.b, event.start)); const touched = (event.processIds ?? []).map((id) => rowOf.get(id)).filter(Boolean);
  if (touched.length) return touched.map((row) => { const p = rowAt(row); return new THREE.Vector3(xOf(t), p.y + heightAt(row, t) + 0.05, p.z); });
  const person = principals.find((p) => event.participants?.includes(p.id)); const group = groups.find((g) => g.id === person?.id); if (!group) return [];
  const own = rows.filter((row) => row.group === group); const p = rowAt(own[Math.floor(own.length / 2)]); return [new THREE.Vector3(xOf(t), p.y + 0.1, p.z)];
};
function placeNotes() {
  const place = new Map(); const top = mindTop(); const back = (node, x) => new THREE.Vector3(x, top.y + noteLayer(node) * 1.6, top.z - noteLayer(node) * 2.2);
  const within = (event) => event.start >= F.a - 0.3 && event.start <= F.b;
  for (const node of graphNodes) { const ts = (moments.get(node.id) ?? []).filter(within).map((e) => e.start).sort((a, b) => a - b); if (ts.length) place.set(node.id, back(node, xOf(ts[Math.floor(ts.length / 2)]))); }
  for (let pass = 0; pass < 4; pass += 1) for (const node of graphNodes) {
    if (place.has(node.id)) continue; const near = (neighbours.get(node.id) ?? []).map((id) => place.get(id)).filter(Boolean);
    if (near.length) place.set(node.id, back(node, near.reduce((sum, p) => sum + p.x, 0) / near.length + ((node.id.length % 7) - 3) * 0.9));
  }
  const enters = new Map();
  for (const node of graphNodes) { const ts = (moments.get(node.id) ?? []).filter(within).map((e) => e.start); if (ts.length) enters.set(node.id, Math.min(...ts)); }
  for (let pass = 0; pass < 4; pass += 1) for (const node of graphNodes) { if (enters.has(node.id)) continue; const near = (neighbours.get(node.id) ?? []).map((id) => enters.get(id)).filter((t) => t !== undefined); if (near.length) enters.set(node.id, Math.min(...near)); }
  const rest = graphNodes.filter((node) => !place.has(node.id)).sort((a, b) => String(a.born?.at ?? '').localeCompare(String(b.born?.at ?? '')));
  rest.forEach((node, i) => place.set(node.id, back(node, -LENGTH / 2 + ((i + 0.5) / rest.length) * LENGTH)));
  // A thought arrives with the first moment it is about; one about no moment arrives when the play reaches where it stands,
  // so no thought comes before the history it sits over.
  for (const light of notes) { light.position.copy(place.get(light.userData.id)); light.userData.t = enters.get(light.userData.id) ?? timeAtX(light.position.x); light.userData.moments = (moments.get(light.userData.id) ?? []).filter(within); }
}
// The layer of thoughts sits above and behind whatever the view holds.
function mindTop() {
  const m = smooth(blend.now); const together = { y: AMP + 8, z: zBackNow() - 9 };
  if (!layersBounds || m < 0.001) return together;
  const layers = { y: layersBounds.y1 + LAMP + 8, z: layersBounds.z0 - 9 };
  return { y: together.y + (layers.y - together.y) * m, z: together.z + (layers.z - together.z) * m };
}
const zBackNow = () => Math.min(...rows.map((row) => rowAt(row).z));
const zFrontNow = () => { const fronts = [...rows.map((row) => rowAt(row).z), ...nodes.filter((node) => node.shown && presence(node) > 0.5).map((node) => nodeAt(node).z)]; return Math.max(...fronts); };
function drawNotes() {
  mindLines.begin(); noteLinks.begin();
  const shown = new Set();
  for (const light of notes) {
    const selected = light.userData.id === selectedPart?.unit.id;
    light.scale.setScalar((light.userData.node.category === 'passage' ? 2.6 : 2.0) * (selected ? 1.8 : 1));
    if (!light.visible) continue; shown.add(light.userData.id); const on = lit === light || selected; if (!opt.edges && !on) continue;
    for (const event of light.userData.moments) if (shownByPlay(event.start, bornAt(event))) for (const point of meet(event)) mindLines.add(light.position.x, light.position.y, light.position.z, point.x, point.y, point.z, light.userData.color, on ? 0.95 : 0.13);
    // Pointed at, a document also shows the people and processes it is attached to.
    if (on) for (const item of light.userData.attached) {
      const own = item.kind === 'process' ? [rowOf.get(item.id)].filter(Boolean) : item.kind === 'referent' ? rows.filter((row) => row.group.id === item.id || ownerOf(row.measure)?.id === item.id) : [];
      if (!own.length) continue; const row = frontOf(own); const p = rowAt(row); const t = timeAtX(light.position.x); const target = new THREE.Vector3(X(Math.max(F.a, Math.min(F.b, t))), p.y + heightAt(row, Math.max(F.a, Math.min(F.b, t))) + 0.05, p.z);
      mindLines.add(light.position.x, light.position.y, light.position.z, target.x, target.y, target.z, item.kind === 'process' ? color(row.group.hue) : WHITE, 0.9, 0.5);
    }
  }
  const edge = color('#c9d4ff');
  if (opt.edges) for (const [a, b] of noteEdges) if (shown.has(a) && shown.has(b)) { const p = noteById.get(a).position; const q = noteById.get(b).position; noteLinks.add(p.x, p.y, p.z, q.x, q.y, q.z, edge, 0.16); }
  const selected = terrain.on ? terrain.mind?.find((point) => point.userData.node.id === selectedPart?.unit.id) : noteById.get(selectedPart?.unit.id);
  const labelParent = terrain.on ? terrain.group : mind;
  if (labelParent && selectedDocumentLabel.parent !== labelParent) labelParent.add(selectedDocumentLabel);
  selectedDocumentLabel.visible = Boolean(selected?.visible);
  if (selectedDocumentLabel.visible) { selectedDocumentLabel.position.copy(selected.position).add(new THREE.Vector3(0, terrain.on ? 2 * TS : 2, 0)); selectedDocumentLabel.element.textContent = `Selected document · ${selectedPart.n} ${selectedPart.title}`; }
  mindLines.end(); noteLinks.end();
}

// Causal links between the story's events, as arcs in a lane before the processes.
const arcsBuffer = new Lines(); const arcSparks = [];
const causalAll = data.relations.filter((relation) => byId.has(relation.source) && byId.has(relation.target) && Number.isFinite(byId.get(relation.source).start) && Number.isFinite(byId.get(relation.target).start));
const inStory = (event) => event && Number.isFinite(event.start) && event.start >= T0 - 0.05 && event.start <= T1;
const causal = causalAll.filter((relation) => inStory(byId.get(relation.source)) && inStory(byId.get(relation.target)));
const counts = causal.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {});
const laneTag = label('lane', `${causal.length} causal links`, new THREE.Vector3(-LENGTH / 2 - 1.2, 0.6, zFront + 6.5), [1, 0.5]);
const sub = document.createElement('span'); sub.textContent = Object.entries(counts).map(([k, n]) => `${n} ${k.replace(/_/g, ' ').replace('realizes forecast', 'fulfil a forecast')}`).join(' · '); laneTag.element.append(sub);
const laneAt = () => { const m = smooth(blend.now); const together = { y: 0.15, z: zFrontNow() + 6.5 }; if (!layersBounds || m < 0.001) return together; const layers = { y: layersBounds.y0 + 0.15, z: layersBounds.z1 + 6.5 }; return { y: together.y + (layers.y - together.y) * m, z: together.z + (layers.z - together.z) * m }; };
// Each causal link runs as an arc from where one event stands to where the other does: the top of its thread through the
// highest process it moves, else the top of its person's front row, else the world's. Hover one to read it, click to keep it.
const KIND_WORDS = { causes: ['Causes', 'causes'], enables: ['Enables', 'enables'], realizes_forecast: ['Fulfils a forecast', 'fulfils a forecast made in'], constrains: ['Constrains', 'constrains'], other: ['A link', 'is linked to'] };
function eventPoint(event) {
  const t = Math.max(F.a, Math.min(F.b, event.start)); let best = null;
  for (const row of (event.processIds ?? []).map((id) => rowOf.get(id)).filter((item) => item?.wall.visible)) { const p = rowAt(row); const y = p.y + heightAt(row, t) + 0.05; if (!best || y > best.y) best = new THREE.Vector3(X(t), y, p.z); }
  if (best) return best;
  const person = principals.find((item) => item.id === event.owner || event.participants?.includes(item.id));
  const own = rows.filter((row) => (person ? ownerOf(row.measure) === person : !ownerOf(row.measure))); const list = own.length ? own : rows; const front = frontOf(list); const p = rowAt(front);
  return new THREE.Vector3(X(t), p.y + heightAt(front, t) + 0.05, p.z);
}
let arcTargets = [];
function drawArcs() {
  arcsBuffer.begin(); let s = 0; arcTargets = []; const on = opt.show.has('causal') && opt.edges; laneTag.visible = false;
  if (on) for (const relation of causalAll) {
    const source = byId.get(relation.source); const target = byId.get(relation.target);
    if (!inView(source.start, 0.05) || !inView(target.start, 0.05) || !seen(relation, Math.max(source.start, target.start))) continue;
    const a = eventPoint(source); const b = eventPoint(target); const hex = KIND[relation.kind] ?? '#9a9a9a'; const c = color(hex); const lit3 = litArc?.relation === relation;
    const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 1.2 + Math.abs(b.x - a.x) * 0.12, (a.z + b.z) / 2); const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(40);
    for (let i = 1; i < pts.length; i += 1) arcsBuffer.add(pts[i - 1].x, pts[i - 1].y, pts[i - 1].z, pts[i].x, pts[i].y, pts[i].z, lit3 ? WHITE : c, lit3 ? 1 : 0.8);
    for (const point of [a, b]) { if (s >= arcSparks.length) { const sprite = spark('#ffffff', 1.1); field.add(sprite); arcSparks.push(sprite); } const sprite = arcSparks[s]; sprite.material.color.set(hex); sprite.position.copy(point); sprite.visible = true; s += 1; }
    arcTargets.push({ kind: 'arc', relation, source, target, pts: pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1) });
  }
  for (let i = s; i < arcSparks.length; i += 1) arcSparks[i].visible = false;
  arcsBuffer.end();
}
// What a causal link says, in words: the two events, what the one does to the other, and when.
function arcLines(target) {
  const { relation, source, target: to } = target; const [kind, verb] = KIND_WORDS[relation.kind] ?? [relation.kind, relation.kind];
  return [['k', `A causal link · ${kind}`], ['v', clip(source.label, 160)], ['m', `${verb}`], ['v', clip(to.label, 160)],
    ...(relation.description ? [['m', relation.description]] : []), ['a', `${timeText(source.start, 2)} → ${timeText(to.start, 2)}`],
    ...(source.description ? [['a', `${clip(source.label, 50)}: ${clip(source.description, 240)}`]] : []), ...(to.description ? [['a', `${clip(to.label, 50)}: ${clip(to.description, 240)}`]] : [])];
}

// The sweep: a plane of light at the story's moment.
const sweep = new THREE.Mesh(new THREE.PlaneGeometry(zFront - zBack + 12, AMP + 6), new THREE.MeshBasicMaterial({ color: '#9fb8ff', transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
sweep.rotation.y = Math.PI / 2; sweep.position.set(0, (AMP + 6) / 2 - 0.5, (zFront + zBack) / 2 + 2); field.add(sweep);

// ---- what the panel adds: the tree's Events, subsidiary processes, readings and prose ------------------------------------------
const extraWalls = new Tris(); const extraCrests = new Lines(); const extraGrid = new Lines(); const connectors = new Lines(); const chips = new Tris(true); const extraGlows = new Glows(); const proseLines = new Lines();
const nodeAt = (node) => { const m = smooth(blend.now); return { y: (node.yT ?? 0) + ((node.yL ?? node.yT ?? 0) - (node.yT ?? 0)) * m, z: (node.zT ?? 0) + ((node.zL ?? node.zT ?? 0) - (node.zT ?? 0)) * m }; };
const nodeVis = (node) => { const m = smooth(blend.now); return (1 - m) * (node.inT ? 1 : 0) + m * (node.inL ? 1 : 0); };
const shownNow = (node) => (smooth(blend.now) < 0.5 ? node.inT : node.inL);
const nearestShown = (id) => { for (let current = id, hops = 0; current && hops < 16; current = treeById.get(current)?.parent, hops += 1) { const node = nodeById.get(current); if (node?.shown && shownNow(node)) return node; } return null; };
const BAR = 0.3; const WHITE = color('#ffffff'); const RIM = color('#101114');
// The point readings and prose hang from: the top of an Event's bar at its time, or of the nearest shown Event holding it,
// else the front of its person's rows.
function anchor(eventId, t) {
  const node = nearestShown(eventId);
  if (!node) {
    const event = byId.get(eventId); const person = principals.find((p) => p.id === event?.owner); const own = rows.filter((row) => ownerOf(row.measure) === person);
    if (!own.length || !Number.isFinite(t)) return null; const p = rowAt(frontOf(own)); const top = Math.max(...own.map((row) => heightAt(row, t)));
    return { x: X(t), y: p.y + top + 1.2, z: p.z + 0.8, node: null, own: false };
  }
  const p = nodeAt(node); const time = Math.max(node.t0, Math.min(node.t1, t ?? node.t0));
  return { x: X(time), y: p.y + (node.kind === 'sub' ? BAR * 1.6 : BAR) + 0.02, z: p.z, node, own: node.id === eventId };
}
const scratch = new THREE.Vector3();
const screen = (x, y, zz) => { const v = scratch.set(x, y, zz).project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, ok: v.z < 1 }; };
let extraTargets = [];
function drawExtras() {
  const m = smooth(blend.now); const left = -LENGTH / 2; const right = LENGTH / 2; const clampX = (x) => Math.max(left - 0.5, Math.min(right + 0.5, x));
  for (const buffer of [extraWalls, extraCrests, extraGrid, connectors, chips, extraGlows, proseLines]) buffer.begin();
  extraTargets = []; selectedLinks = [];
  // Floors: faint planes with the time's lines across them.
  if (m > 0.01) { const edge = color('#27324a'); const line = color('#1b2233'); const ticks = currentTicks;
    for (const floor of floors) { const y = floor.y * m; extraGrid.add(left, y, floor.z1 + 0.4, right, y, floor.z1 + 0.4, edge, 0.9 * m); extraGrid.add(left, y, floor.z0 - 0.4, right, y, floor.z0 - 0.4, line, 0.7 * m);
      for (const tick of ticks) { const x = X(tick.t); extraGrid.add(x, y, floor.z0 - 0.4, x, y, floor.z1 + 0.4, tick.major ? edge : line, (tick.major ? 0.9 : 0.55) * m); } } }
  for (const node of nodes) {
    if (!node.shown) continue; const vis = nodeVis(node) * shownByPlay(node.event.start ?? node.t0, bornAt(node.event)); if (vis < 0.01) continue;
    const p = nodeAt(node); const hue = color(hueOfOwner(node.owner)); const sub = node.kind === 'sub'; const own = node.event.context === 'inner';
    const x0 = X(node.t0); const x1 = X(node.t1); if (x1 < left - 1 || x0 > right + 1) continue;
    const a = clampX(x0); const b = clampX(x1); const wide = b - a; const top = p.y + (sub ? BAR * 1.6 : BAR); const tint = hue.clone().lerp(WHITE, sub ? 0.15 : 0.3);
    const lit2 = litChain.has(node.id); const alpha = (sub ? 0.05 : node.depth <= 1 ? 0.1 : 0.2) * (lit2 ? 2.5 : 1) * vis; const live = shownNow(node);
    if (wide > 0.12) {
      const crestAlpha = (lit2 ? 1 : sub ? 0.4 : node.depth <= 1 ? 0.5 : 0.75) * vis;
      if (own) { for (let x = a; x < b; x += 0.9) extraCrests.add(x, top, p.z, Math.min(b, x + 0.5), top, p.z, tint, crestAlpha); }
      else { extraWalls.quad(a, b, p.y, top, p.y, top, p.z, tint, sub ? alpha : 0, alpha * (sub ? 1 : 1.2)); extraCrests.add(a, top, p.z, b, top, p.z, tint, crestAlpha); }
      if (sub) extraCrests.add(a, p.y, p.z, b, p.y, p.z, tint, 0.2 * vis);
      if (x0 >= left) extraCrests.add(a, p.y, p.z, a, top, p.z, tint, 0.8 * vis);
      if (live) extraTargets.push({ kind: sub ? 'sub' : 'event', node, wseg: [[a, top, p.z], [b, top, p.z]] });
    }
    if (wide <= 1.2) { extraGlows.add((a + b) / 2, top, p.z, tint.clone().lerp(WHITE, 0.4), (lit2 ? 1 : 0.95) * vis, wide <= 0.12 ? 15 : 11); if (live) extraTargets.push({ kind: sub ? 'sub' : 'event', node, wpt: [(a + b) / 2, top, p.z] }); }
    // The tree: a thread from each node up to the nearest shown node that holds it (in Layers).
    const parent = node.parent && node.inL ? nearestShown(node.parent) : null;
    if (parent && m > 0.01 && opt.edges) { const q = nodeAt(parent); const x = Math.max(x0, X(parent.t0)); const holds = lit2 && litChain.has(parent.id);
      if ((x >= left && x <= right) || holds) connectors.add(clampX(x), top, p.z, clampX(x), q.y, q.z, holds ? WHITE : tint, (holds ? 0.85 : 0.16) * m, (holds ? 0.85 : 0.05) * m); }
  }
  // Lens readings: a small bar of each reading's answers over its record, one row per lens.
  lensList.filter((lens) => opt.lenses.has(lens.id)).forEach((lens, row) => {
    for (const reading of lens.readings) {
      if (!shownByPlay(reading.t, bornAt(reading))) continue;
      const place = anchor(reading.eventId, reading.t); if (!place || place.x < left || place.x > right) continue;
      const w = 3.1; const h = 0.62; const y = place.y + 0.9 + row * 0.95; let x = place.x - w / 2; const alpha = reading.earlier ? 0.4 : 1; const on = litReading === reading;
      chips.quad(x - 0.12, x + w + 0.12, y - 0.12, y + h + 0.12, y - 0.12, y + h + 0.12, place.z, on ? WHITE : RIM, 0.95, 0.95);
      for (const answer of reading.answers.filter((item) => item.weight > 0).sort((a, b) => (a.key === 'remainder') - (b.key === 'remainder'))) { const width = w * answer.weight; chips.quad(x, x + width, y, y + h, y, y + h, place.z, color(lens.colorOf(answer.key)), alpha, alpha); x += width; }
      extraTargets.push({ kind: 'lens', lens, reading, wpt: [place.x, y + h / 2, place.z], r: 20 });
    }
  });
  // Prose: each part of the story over the moments it tells.
  if (opt.show.has('prose')) {
    const top = mindTop(); const y = top.y - 4.5; const zz = top.z + 4; const c = color('#fff0d0');
    for (const unit of prose) {
      if (!shownByPlay(unit.t, bornAt(unit))) continue; const x = X(unit.t); if (x < left - 1 || x > right + 1) continue; const on = litUnit === unit;
      chips.quad(x - 0.35, x + 0.35, y, y + 0.9, y, y + 0.9, zz, c, on ? 0.9 : 0.55, on ? 0.9 : 0.55);
      if (opt.edges || on) for (const tell of unit.tells ?? []) { const place = anchor(tell.eventId, byId.get(tell.eventId)?.start); if (place) proseLines.add(x, y, zz, place.x, place.y, place.z, c, on ? 0.9 : 0.16, on ? 0.7 : 0.05); }
      extraTargets.push({ kind: 'prose', unit, wpt: [x, y + 0.45, zz], r: 14 });
    }
  }
  // A selected document and its declared links remain inspectable without changing either playback clock.
  const selectedDocument = noteById.get(selectedPart?.unit.id);
  if (selectedDocument?.visible) for (const eventId of selectedEventIds) {
    const event = byId.get(eventId); if (!Number.isFinite(event?.start) || !inView(event.start)) continue;
    const point = anchor(eventId, event.start) ?? meet(event)[0]; if (!point) continue;
    const from = selectedDocument.position; const c = color('#ffe6ae');
    proseLines.add(from.x, from.y, from.z, point.x, point.y, point.z, c, 0.95, 0.8);
    extraGlows.add(point.x, point.y, point.z, c, 1, 18);
    selectedLinks.push({ event, point });
  }
  for (const buffer of [extraWalls, extraCrests, extraGrid, connectors, chips, extraGlows, proseLines]) buffer.end();
}

// Labels of what the panel adds: placed by priority, never over each other or the panels.
const labels2 = (() => {
  const layer = document.getElementById('labels2'); const pool = new Map();
  const element = (key, className, html) => {
    let item = pool.get(key);
    if (!item) { const el = document.createElement('div'); el.className = `lbl ${className}`; layer.append(el); item = { el, html: null, w: 0, h: 0 }; pool.set(key, item); }
    if (item.html !== html) { item.el.innerHTML = html; item.html = html; item.w = 0; }
    if (item.el.className !== `lbl ${className}`) { item.el.className = `lbl ${className}`; item.w = 0; }
    return item;
  };
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function update() {
    if (terrain.on) { for (const item of pool.values()) if (item.hidden !== true) { item.el.classList.add('hide'); item.hidden = true; } return; }
    const wanted = []; const m = smooth(blend.now); const left = -LENGTH / 2; const right = LENGTH / 2;
    if (m > 0.5) for (const floor of floors) {
      const counts2 = new Map(); for (const item of floor.roles) { const key = item.measure ? 'processes' : item.event.role; counts2.set(key, (counts2.get(key) ?? 0) + 1); }
      const names = { world: 'the world', development: 'developments', life: 'lives', inner: 'inner lives', period: 'periods', arc: 'change arcs', part: 'parts', moment: 'moments', slow: 'slow processes', phase: 'phases', processes: 'processes' };
      const text = [...counts2].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, n]) => (key === 'world' ? names[key] : `${n} ${names[key] ?? key}`)).join(' · ');
      // A floor's name heads it on the left, above its first row.
      wanted.push({ key: `floor:${floor.level}`, cls: 'floor', html: `Level ${floor.level}<span>${esc(text)}</span>`, p: [left - 1.2, floor.y * m, floor.z0 - 0.3], ax: 1, ay: 1, pri: 950 });
    }
    for (const node of nodes) {
      if (!node.shown || !shownNow(node) || !shownByPlay(node.event.start ?? node.t0, bornAt(node.event))) continue; const p = nodeAt(node);
      const x0 = Math.max(left, X(node.t0)); const x1 = Math.min(right, X(node.t1)); if (x1 < left || x0 > right) continue;
      const wide = x1 - x0; const top = p.y + (node.kind === 'sub' ? BAR * 1.6 : BAR); const big = node.depth <= 1 || wide > LENGTH * 0.25;
      const pri = 400 + Math.min(200, wide * 3) - node.depth * 20 + (node.event.cuts ?? 0) * 4 + (litChain.has(node.id) ? 400 : 0);
      wanted.push({ key: `ev:${node.id}`, cls: `event${big ? ' big' : ''}${node.event.context === 'inner' ? ' inner' : ''}`, html: esc(words(node.event.name, big ? 52 : 40)), p: [wide > 1.2 ? x0 + 0.25 : (x0 + x1) / 2, top + 0.12, p.z], ax: wide > 1.2 ? 0 : 0.5, ay: 1, pri });
    }
    if (opt.show.has('prose')) { const top = mindTop(); for (const unit of prose) { if (!shownByPlay(unit.t, bornAt(unit))) continue; const x = X(unit.t); if (x >= left && x <= right) wanted.push({ key: `prose:${unit.id}`, cls: 'prose', html: esc(unit.title ?? ''), p: [x, top.y - 3.35, top.z + 4], ax: 0.5, ay: 1, pri: 800 }); } }
    for (const { event, point } of selectedLinks) wanted.push({ key: `selected-event:${event.id}`, cls: 'event', html: esc(words(event.label, 45)), p: [point.x, point.y + 0.4, point.z], ax: 0.5, ay: 1, pri: 1200 });
    const panels = [...document.querySelectorAll('.hud.caption, .hud.bar, .hud.legend, .hud.title, .hud.stats, #tools, .pop:not([hidden]), #details:not([hidden])')].map((el) => el.getBoundingClientRect()).filter((r) => r.width);
    const placed = [...panels.map((r) => ({ l: r.left - 6, r: r.right + 6, t: r.top - 4, b: r.bottom + 4 }))];
    for (const el of labels.domElement.querySelectorAll('.label.row, .label.group, .label.year, .label.lane')) { if (el.style.display === 'none') continue; const r = el.getBoundingClientRect(); if (r.width) placed.push({ l: r.left, r: r.right, t: r.top, b: r.bottom }); }
    wanted.sort((a, b) => b.pri - a.pri);
    const items = wanted.map((want) => element(want.key, want.cls, want.html));
    const fresh = items.filter((item) => !item.w); for (const item of fresh) item.el.style.transform = 'translate(-9999px,0)';
    for (const item of fresh) { item.w = item.el.offsetWidth; item.h = item.el.offsetHeight; }
    const next = new Map();
    wanted.forEach((want, i) => {
      const item = items[i]; const s = screen(...want.p); if (!s.ok || s.x < -200 || s.x > innerWidth + 200) return;
      const l = s.x - item.w * want.ax; const t = s.y - item.h * want.ay; const box = { l, r: l + item.w, t, b: t + item.h };
      if (box.l < 2 || box.r > innerWidth - 2 || box.t < 2 || box.b > innerHeight - 2) return;
      if (placed.some((o) => box.l < o.r + 3 && box.r > o.l - 3 && box.t < o.b + 1 && box.b > o.t - 1)) return;
      placed.push(box); next.set(want.key, [item, Math.round(l), Math.round(t)]);
    });
    for (const [item, l, t] of next.values()) { const transform = `translate(${l}px, ${t}px)`; if (item.transform !== transform) { item.el.style.transform = transform; item.transform = transform; } if (item.hidden !== false) { item.el.classList.remove('hide'); item.hidden = false; } }
    for (const [key, item] of pool) if (!next.has(key) && item.hidden !== true) { item.el.classList.add('hide'); item.hidden = true; }
  }
  return { update };
})();

// ---- the terrain: every function of the model over time, as the landscape showed it ------------------------------------------------
// Each person's life (its periods as plateaus, its shocks as peaks that fall away through the adaptation), the processes it
// runs through (how much happens in each), what they want, feel and expect (the share of each Cut series' main answer), and
// the world's long developments rise as ridges of one terrain, the world behind the lives. Events stand as beams, decisions
// as diamonds, and the agent's notes and prose float above, threaded to the moments they concern. Readings and a holder's
// understanding are not functions of the world: the terrain draws the world and the lives. It is built the first time it
// is shown, over whatever years the view shows.
const terrain = { built: false, on: false };
const TS = LENGTH / 96; const TNX = 420; const TAMP = 8.5 * TS; const TROW = 2.1 * TS; const TGAP = 4.2 * TS; const TFOG = 0.0085 / TS;
const TERRAIN_GLARE = { full: [0.95, 0.55, 0.12], soft: [0.3, 0.4, 0.35] };
const shortName = (text, n = 40) => { const head = String(text ?? '').replace(/\s+/g, ' ').split(/[:;,]| from | since | built /)[0].trim(); if (head.length <= n) return head; const cut = head.slice(0, n - 1); const space = cut.lastIndexOf(' '); return `${space > n * 0.6 ? cut.slice(0, space) : cut}…`; };
const hashOf = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
const fieldRows = () => rows; // the processes' rows, for the terrain's named processes
const TERRAIN_KINDS = new Set(['processes', 'threads', 'decisions', 'causal', 'notes']); // the details the terrain shows
function buildTerrain() {
  terrain.built = true;
  const group = new THREE.Group(); group.visible = false; scene.add(group); terrain.group = group;
  group.add(new THREE.AmbientLight('#8fa0c0', 0.55)); const sun = new THREE.DirectionalLight('#ffffff', 1.1); sun.position.set(-30 * TS, 60 * TS, 40 * TS); group.add(sun);
  const events = data.events.filter((event) => event.role !== 'reading' && event.context !== 'understanding');
  const byEvent = new Map(events.map((event) => [event.id, event])); const kids = new Map(); for (const event of events) if (event.parent) push(kids, event.parent, event.id);
  const descendants = (id) => { const out = []; const stack = [...(kids.get(id) ?? [])]; while (stack.length) { const next = stack.pop(); out.push(next); stack.push(...(kids.get(next) ?? [])); } return out; };
  const people = data.people.filter((person) => person.principal); for (const person of data.people) if (people.length < 3 && !people.includes(person) && person.life) people.push(person);
  const persons = people.slice(0, 3); terrain.persons = persons;
  // The lives' years set how a shock rises, and which long developments count, as the landscape measured them.
  const lifeStarts = persons.map((person) => person.life?.start).filter(Number.isFinite);
  const ends = events.map((event) => event.end ?? event.start).filter(Number.isFinite).sort((a, b) => a - b); const starts = events.map((event) => event.start).filter(Number.isFinite);
  const present = data.window?.end ?? ends[Math.floor((ends.length - 1) * 0.9)] ?? 1; const earliest = Math.min(...starts, ...lifeStarts, present - 1);
  const t0 = data.window ? Math.min(data.window.start, ...lifeStarts) : earliest; const pad = (present - t0) * 0.02; const domain = [t0 - pad, present + pad];
  const deep = present - earliest > 400; const uMax = Math.log10(1 + present - earliest);
  const P = deep ? (t) => Math.min(1.02, 1 - Math.log10(1 + Math.max(0, present - t)) / uMax) : (t) => (t - domain[0]) / (domain[1] - domain[0]);
  const sigma = (domain[1] - domain[0]) / 160; const sigmaP = 1 / 170;
  const born = (items) => Math.min(...items.map((item) => (item?.at ? Date.parse(item.at) : Infinity)));
  // The named processes (the curtains of the processes view) as ridges: each authored path on its own scale, fading in and
  // out at its first and last value. They show with Details' named processes.
  const namedRows = (person) => fieldRows().filter((row) => (person ? ownerOf(row.measure) === person : !ownerOf(row.measure))).map((row) => ({
    id: `named:${row.measure.id}`, label: NAMES[row.measure.id], kind: 'named', amp: 0.8, born: bornAt(row.measure),
    recipe: () => { const samples = new Float32Array(TNX); const first = row.measure.points[0].t; const last = row.measure.points.at(-1).t; const a = fracOf(F, first); const b = fracOf(F, last);
      for (let i = 0; i < TNX; i += 1) { const q = terrain.ps[i]; const d = q < a ? a - q : q > b ? q - b : 0; const t = Math.max(first, Math.min(last, terrain.ts[i])); samples[i] = (row.height(t) / AMP) * Math.exp(-(d * d) / (2 * sigmaP * sigmaP)); }
      return samples; } }));
  // A row's height at each sample comes from a recipe run over the samples of the years on screen.
  const rows = [];
  const plateau = (samples, start, end, height) => { if (!Number.isFinite(start)) return; const a = fracOf(F, start); const b = fracOf(F, Number.isFinite(end) ? end : start);
    for (let i = 0; i < TNX; i += 1) { const q = terrain.ps[i]; const d = q < a ? a - q : q > b ? q - b : 0; const v = height * Math.exp(-(d * d) / (2 * sigmaP * sigmaP)); if (v > samples[i]) samples[i] = v; } };
  const density = (ids, cutWeight = 0.35) => { const samples = new Float32Array(TNX);
    for (const id of ids) { const event = byEvent.get(id); if (!event || !Number.isFinite(event.start)) continue; const weight = 1 + cutWeight * (event.cuts ?? 0); const a = fracOf(F, event.start); const b = fracOf(F, Number.isFinite(event.end) ? event.end : event.start);
      for (let i = 0; i < TNX; i += 1) { const q = terrain.ps[i]; const d = q < a ? a - q : q > b ? q - b : 0; if (d < sigmaP * 6) samples[i] += weight * Math.exp(-(d * d) / (2 * sigmaP * sigmaP)); } }
    const max = Math.max(...samples, 1e-6); for (let i = 0; i < TNX; i += 1) samples[i] /= max; return samples; };
  persons.forEach((person, order) => {
    const hue = HUES[order % HUES.length]; const owner = { id: person.id, label: person.name, hue };
    rows.push({ id: `${person.id}:life`, label: 'life, periods and shocks', group: owner, hue, kind: 'life', born: born([person.life?.born, ...person.periods.map((period) => period.born), ...person.arcs.map((arc) => arc.born)]),
      recipe: () => { const life = new Float32Array(TNX); for (const period of person.periods) plateau(life, period.start, period.end, 0.28);
        for (const arc of person.arcs) { if (!Number.isFinite(arc.focal)) continue; const fall = Math.max((arc.adaptationEnd ?? arc.focal) - arc.focal, sigma * 2);
          for (let i = 0; i < TNX; i += 1) { const d = terrain.ts[i] - arc.focal; const v = d >= 0 ? Math.exp(-d / fall) : Math.exp(-(d * d) / (2 * sigma * sigma)); if (v > life[i]) life[i] = v; } }
        return life; } });
    for (const row of namedRows(person)) rows.push({ ...row, group: owner, hue });
    for (const process of person.processes ?? []) {
      const ids = descendants(process.eventId); if (!ids.length) continue;
      rows.push({ id: process.eventId, label: clip(String(process.what ?? '').replace(/^.*?\bis\b\s*/i, ''), 34) || process.eventId.split('.').at(-1), group: owner, hue, kind: 'process', ids, born: born(ids.map((id) => byEvent.get(id)?.born)), recipe: () => density(ids) });
    }
    for (const series of person.series ?? []) {
      const counts = new Map(); for (const point of series.points) { const key = point.answers[0]?.key; if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
      const key = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; if (!key) continue;
      const points = series.points.filter((point) => Number.isFinite(point.t)).map((point) => ({ t: point.t, v: point.answers.find((answer) => answer.key === key)?.weight ?? 0 })).sort((a, b) => a.t - b.t); if (!points.length) continue;
      rows.push({ id: `${person.id}:${series.question}`, label: `${series.kind}: ${clip(key.replace(/[_.-]+/g, ' '), 22)}`, group: owner, hue, kind: 'series', born: born(series.points.map((point) => point.born)),
        recipe: () => { const samples = new Float32Array(TNX);
          if (points.length === 1) plateau(samples, points[0].t, points[0].t + sigma * 20, points[0].v);
          else for (let i = 0; i < TNX; i += 1) { const t = terrain.ts[i]; if (t < points[0].t) continue; const next = points.findIndex((point) => point.t > t);
            if (next < 0) samples[i] = points.at(-1).v; else { const a = points[next - 1]; const b = points[next]; const f = (t - a.t) / Math.max(1e-9, b.t - a.t); samples[i] = a.v + (b.v - a.v) * (0.5 - Math.cos(Math.PI * f) / 2); } }
          return samples; } });
    }
  });
  const worldNamed = namedRows(null);
  // The world's long developments: each Event outside the lives, long on the landscape's own axis, with what happens inside it.
  const owned = new Set(persons.flatMap((person) => [person.life?.eventId, ...person.periods.map((period) => period.eventId), ...person.arcs.map((arc) => arc.eventId), ...(person.processes ?? []).map((process) => process.eventId)]).filter(Boolean));
  const inLives = new Set(persons.flatMap((person) => (person.life ? [person.life.eventId, ...descendants(person.life.eventId)] : [])));
  const span = domain[1] - domain[0]; const world = { id: 'world', label: 'The world', hue: WORLD };
  const tops = events.filter((event) => !owned.has(event.id) && !inLives.has(event.id) && Number.isFinite(event.start) && Number.isFinite(event.end) && P(event.end) - P(event.start) > 0.02 && (event.end - event.start) < span * 3)
    .map((event) => ({ event, ids: [event.id, ...descendants(event.id)] })).sort((a, b) => (b.event.end - b.event.start) - (a.event.end - a.event.start)).slice(0, 12);
  rows.unshift(...worldNamed.map((row) => ({ ...row, group: world, hue: WORLD })), ...tops.map(({ event, ids }) => ({ id: event.id, label: clip(event.label, 34), name: shortName(event.label), group: world, hue: WORLD, kind: 'world', amp: 0.6, ids, born: born(ids.map((id) => byEvent.get(id)?.born)),
    recipe: () => { const inside = ids.slice(1); const samples = inside.length ? density(inside, 0.2) : new Float32Array(TNX); for (let i = 0; i < TNX; i += 1) samples[i] *= 0.9; plateau(samples, event.start, event.end, 0.16); return samples; } })));
  let zz = 0; let last = null; for (const row of rows) { if (last && last !== row.group.id) zz += TGAP; row.z = zz; zz += TROW; last = row.group.id; }
  const depth = Math.max(zz - TROW, 1); for (const row of rows) { row.z -= depth / 2; row.scale = 1; row.target = 1; row.color = new THREE.Color(row.hue); }
  Object.assign(terrain, { rows, depth, zMin: -depth / 2 - TROW * 1.5, zMax: depth / 2 + TROW * 1.5, byEvent, P, events });
  terrain.ts = new Float64Array(TNX); terrain.ps = new Float64Array(TNX);
  // The ground: one heightfield, every row a ridge along it, clipped at the story's moment while it plays.
  terrain.clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), LENGTH); renderer.localClippingEnabled = true;
  const NZ = Math.max(8, Math.ceil(((terrain.zMax - terrain.zMin) / TROW) * 5));
  const geometry = new THREE.PlaneGeometry(LENGTH, terrain.zMax - terrain.zMin, TNX - 1, NZ - 1); geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, (terrain.zMin + terrain.zMax) / 2);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TNX * NZ * 3), 3));
  terrain.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, emissive: new THREE.Color('#0a0c12'), clippingPlanes: [terrain.clip] })); group.add(terrain.mesh);
  const zAt = (j) => terrain.zMin + (j / (NZ - 1)) * (terrain.zMax - terrain.zMin);
  for (const row of rows) {
    row.reach = []; for (let j = 0; j < NZ; j += 1) { const d = (zAt(j) - row.z) / (TROW * 0.42); const w = Math.exp(-d * d); if (w > 0.01) row.reach.push([j, w]); }
    const line = new THREE.BufferGeometry(); line.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TNX * 3), 3));
    row.ridge = new THREE.Line(line, new THREE.LineBasicMaterial({ color: row.color, transparent: true, opacity: row.kind === 'world' ? 0.55 : 0.9, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: [terrain.clip] }));
    row.ridge.frustumCulled = false; row.ridge.userData.row = row; group.add(row.ridge);
  }
  // What the ridges are and what their height means, block by block on the right; whose they are on the left.
  const SECTION = { named: ['named processes', 'each on its own scale, as the processes show them'], life: ['life & shocks', 'plateaus are periods, peaks are shocks'], process: ['life processes', 'how much happens in each'], series: ['wants · feels · expects', 'share of the main answer'], world: ['long developments', 'how much happens inside each'] };
  const sections = new Map(); for (const row of rows) { const key = `${row.group.id}|${row.kind}`; if (!sections.has(key)) sections.set(key, { kind: row.kind, zs: [] }); sections.get(key).zs.push(row.z); }
  terrain.sectionNames = [...sections.values()].map((section) => {
    const [name, meaning] = SECTION[section.kind] ?? [section.kind, '']; const element = document.createElement('div'); element.className = 'label section';
    const body = document.createElement('div'); body.className = 'body'; const head = document.createElement('b'); head.textContent = `${section.zs.length > 1 ? `${section.zs.length} ` : ''}${name}`;
    const note = document.createElement('span'); note.textContent = meaning; body.append(head, note); element.append(body);
    const object = new CSS2DObject(element); object.position.set(LENGTH / 2 + 1.7, 0.3, (Math.min(...section.zs) + Math.max(...section.zs)) / 2); object.center.set(0, 0.5); group.add(object); return { object, inner: body };
  });
  terrain.ridgeNames = rows.length <= 14 ? rows.map((row) => { const element = document.createElement('div'); element.className = 'label ridge-name'; const inner = document.createElement('span'); inner.textContent = row.name ?? row.label; element.append(inner);
    const object = new CSS2DObject(element); object.center.set(0, 1); group.add(object); return { object, inner, row }; }) : [];
  const owners = new Map(); for (const row of rows) { if (!owners.has(row.group.id)) owners.set(row.group.id, { ...row.group, zs: [] }); owners.get(row.group.id).zs.push(row.z); }
  terrain.groupNames = [...owners.values()].map((owner) => {
    const z = (Math.min(...owner.zs) + Math.max(...owner.zs)) / 2; const name = label('group', owner.label, new THREE.Vector3(-LENGTH / 2 - 1.8, 0.5, z), [1, 0.5], group); name.element.style.color = owner.hue;
    const count = label('group-count', `${owner.zs.length} functions`, new THREE.Vector3(-LENGTH / 2 - 1.8, -1.4, z), [1, 0.5], group); return [name, count];
  }).flat();
  // Events as beams of light on the ridge of the process or development they happen in, decisions as diamonds above each life.
  const rowOfEvent = new Map(); for (const row of rows) if (row.ids) for (const id of row.ids) if (!rowOfEvent.has(id)) rowOfEvent.set(id, row);
  const beamGeometry = new THREE.CylinderGeometry(0.035 * TS, 0.035 * TS, 1, 6); beamGeometry.translate(0, 0.5, 0);
  terrain.beams = []; terrain.beamOf = new Map();
  terrain.arcs = new Lines(); field.remove(terrain.arcs.object); group.add(terrain.arcs.object);
  for (const event of events) {
    const row = rowOfEvent.get(event.id); if (!row || !Number.isFinite(event.start)) continue; if (Number.isFinite(event.end) && P(event.end) - P(event.start) > 0.2) continue;
    const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: row.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.scale.y = (0.8 + Math.min(4, (event.cuts ?? 0) * 0.9)) * TS; beam.userData = { event, row, t: event.start, born: bornAt(event) }; group.add(beam); terrain.beams.push(beam); terrain.beamOf.set(event.id, beam);
  }
  const gem = new THREE.OctahedronGeometry(0.42 * TS);
  for (const [order, person] of persons.entries()) {
    const lifeRow = rows.find((row) => row.id === `${person.id}:life`); if (!lifeRow) continue;
    for (const decision of person.decisions) {
      if (!Number.isFinite(decision.t)) continue; const hue = HUES[order % HUES.length];
      const mesh = new THREE.Mesh(gem, new THREE.MeshStandardMaterial({ color: hue, emissive: new THREE.Color(hue), emissiveIntensity: decision.drawn ? 1.6 : 0.4, roughness: 0.3 }));
      mesh.userData = { decision, row: lifeRow, t: decision.t, born: bornAt(decision), y: TAMP + 1.2 * TS }; group.add(mesh); terrain.beams.push(mesh);
    }
  }
  // The mind above: each note and passage over the moment it is first about, on the side of whose moment it is.
  const zOf = new Map(); for (const owner of owners.values()) zOf.set(owner.id, (Math.min(...owner.zs) + Math.max(...owner.zs)) / 2);
  const home = new Map(); for (const edge of data.graph.edges) { const event = edge.target.anchor ? byEvent.get(edge.target.event ?? edge.target.anchor) : null; if (event && Number.isFinite(event.start) && !home.has(edge.source)) home.set(edge.source, { event, owner: rowOfEvent.get(event.id)?.group.id ?? persons.find((person) => person.life?.eventId === event.id)?.id ?? null }); }
  const bornTimes = data.graph.nodes.map((node) => bornAt(node)).filter(Number.isFinite); const minBorn = Math.min(...bornTimes, 0); const maxBorn = Math.max(...bornTimes, minBorn + 1);
  terrain.mind = data.graph.nodes.map((node, nodeIndex) => {
    const at = home.get(node.id); const z = at?.owner && zOf.has(at.owner) ? zOf.get(at.owner) : Math.max(...rows.map((row) => row.z)) - 2;
    const hue = at?.owner && at.owner !== 'world' && zOf.has(at.owner) ? HUES[persons.findIndex((person) => person.id === at.owner) % HUES.length] : node.category === 'passage' ? '#fff6e0' : '#c9d4ff';
    const point = spark(hue, (node.category === 'passage' ? 1.6 : node.category === 'world' || node.category === 'director' ? 1.3 : 0.9) * TS);
    point.userData = { node, at, size: point.scale.x, born: bornAt(node), t: at ? at.event.start : -Infinity, z: z + (hashOf(`${node.id}z`) - 0.5) * 3 * TS, y: TAMP + 5 * TS + hashOf(`${node.id}y`) * 5 * TS + (node.category === 'passage' ? 3 * TS : 0),
      order: Number.isFinite(bornAt(node)) ? ((bornAt(node) - minBorn) / (maxBorn - minBorn)) - 0.5 : (nodeIndex + 0.5) / Math.max(1, data.graph.nodes.length) - 0.5, jitter: (hashOf(`${node.id}x`) - 0.5) * 1.2 * TS };
    group.add(point); return point;
  });
  terrain.threads = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(terrain.mind.length * 6), 3)), new THREE.LineBasicMaterial({ color: '#8ea2d8', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  terrain.threads.frustumCulled = false; group.add(terrain.threads);
}
// Lay the terrain over the years on screen: every row's samples again, and each beam, diamond and note in its place.
function layTerrain() {
  if (!terrain.built) return;
  for (let i = 0; i < TNX; i += 1) { const u = i / (TNX - 1); terrain.ps[i] = u; terrain.ts[i] = F.w ? timeAtX((u - 0.5) * LENGTH) : F.a + u * F.s; }
  for (const row of terrain.rows) row.samples = row.recipe();
  for (const beam of terrain.beams) { const { t, row, y } = beam.userData; beam.userData.inWindow = inView(t); beam.position.set(X(Math.max(F.a, Math.min(F.b, t))), y ?? 0, row.z); }
  const positions = terrain.threads.geometry.attributes.position; let n = 0;
  for (const point of terrain.mind) {
    const { at, z, y, order, jitter } = point.userData; const x = at ? X(Math.max(F.a, Math.min(F.b, at.event.start))) : order * LENGTH * 0.9; point.position.set(x + jitter, y, z);
    point.userData.t = at ? at.event.start : timeAtX(x); // a note about no moment arrives when the play reaches where it stands
    if (at && inView(at.event.start, 0.3)) { positions.array.set([point.position.x, point.position.y, point.position.z, X(Math.max(F.a, Math.min(F.b, at.event.start))), 0.3, z], n * 6); n += 1; }
  }
  terrain.threadCount = n; positions.needsUpdate = true; heightsTerrain();
}
// Heights from each row's samples and how far it has risen; colour from the row that rises highest at each point.
function heightsTerrain() {
  const position = terrain.mesh.geometry.attributes.position; const colour = terrain.mesh.geometry.attributes.color; const count = position.count;
  const heights = new Float32Array(count); const winner = new Int32Array(count).fill(-1); const best = new Float32Array(count);
  terrain.rows.forEach((row, r) => { const scale = row.scale * (row.amp ?? 1); if (scale <= 0.001) return;
    for (const [j, w] of row.reach) for (let i = 0; i < TNX; i += 1) { const k = j * TNX + i; const h = row.samples[i] * w * scale; heights[k] += h; if (h > best[k]) { best[k] = h; winner[k] = r; } } });
  const dark = color('#0b0e15'); const mix = new THREE.Color();
  for (let k = 0; k < count; k += 1) { const h = Math.min(1.25, heights[k]); position.setY(k, h * TAMP); const r = winner[k]; if (r < 0) { colour.setXYZ(k, dark.r, dark.g, dark.b); continue; } mix.copy(dark).lerp(terrain.rows[r].color, Math.min(1, 0.18 + h * 0.9)); colour.setXYZ(k, mix.r, mix.g, mix.b); }
  position.needsUpdate = true; colour.needsUpdate = true; terrain.mesh.geometry.computeVertexNormals(); terrain.mesh.geometry.computeBoundingSphere();
  for (const row of terrain.rows) {
    const scale = row.scale * (row.amp ?? 1); const line = row.ridge.geometry.attributes.position;
    for (let i = 0; i < TNX; i += 1) line.setXYZ(i, -LENGTH / 2 + (i / (TNX - 1)) * LENGTH, row.samples[i] * scale * TAMP + 0.06, row.z);
    line.needsUpdate = true; row.ridge.visible = scale > 0.01;
  }
  for (const name of terrain.ridgeNames) { const first = name.row.samples.findIndex((value) => value > 0.05); name.object.visible = first >= 0 && name.row.scale > 0.35; if (first >= 0) name.object.position.set(-LENGTH / 2 + (first / (TNX - 1)) * LENGTH, name.row.samples[first] * TAMP * (name.row.amp ?? 1) * name.row.scale + 1.1 * TS, name.row.z); }
}
// What shows at the play's position: in the story's years the ground up to its moment, in the construction what the agent had made.
function applyTerrain() {
  if (!terrain.built || !terrain.on) return;
  const construction = building(); const whole = construction || (atEnd && !playing);
  terrain.clip.constant = whole ? LENGTH : X(Math.max(F.a, Math.min(F.b, now)));
  // Details choose here as in the processes: the named processes, the events, the decisions, the thoughts and the causal links.
  for (const row of terrain.rows) row.target = (construction && row.born > tau) || (row.kind === 'named' && !opt.show.has('processes')) ? 0 : 1;
  const events2 = opt.show.has('threads') || opt.show.has('events'); const thoughts = opt.show.has('notes');
  for (const beam of terrain.beams) beam.visible = beam.userData.inWindow && shownByPlay(beam.userData.t, beam.userData.born) && (beam.userData.decision ? opt.show.has('decisions') : events2);
  for (const point of terrain.mind) {
    const selected = point.userData.node.id === selectedPart?.unit.id;
    point.visible = thoughts && (selected || (construction ? point.userData.born <= tau : whole || point.userData.t <= now));
    point.scale.setScalar(point.userData.size * (selected ? 1.8 : 1));
  }
  terrain.threads.geometry.setDrawRange(0, terrain.threadCount * 2); terrain.threads.visible = opt.edges && thoughts;
  drawTerrainArcs();
}
// The number a ridge stands for where the pointer is: a named process's displayed value, a series' share of its main answer, a
// life's level (1 at a shock's height, 0.28 through a period), or how busy a process or development is against its busiest.
function terrainNumber(row, t, u) {
  const sample = row.samples?.[Math.max(0, Math.min(TNX - 1, Math.round(u * (TNX - 1))))] ?? 0;
  if (row.kind === 'named') { const field2 = rowOf.get(row.id.slice(6)); if (field2) return [...measureValueLines(field2, t), ['a', `Unit: ${field2.measure.unit ?? 'not given'}`]]; }
  if (row.kind === 'series') return [['num', `${Math.round(sample * 100)}%`], ['a', 'The share of its main answer at this moment']];
  if (row.kind === 'life') return [['num', sample.toFixed(2)], ['a', '1 is a shock at its height, 0.28 a period of the life']];
  return [['num', `${Math.round(sample * 100)}%`], ['a', 'How much happens in it here, against its busiest moment']];
}
// Causal links over the terrain: from the top of one event's beam to the other's, else from where the life it belongs to stands.
function terrainPoint(event) {
  const beam = terrain.beamOf.get(event.id); if (beam) return new THREE.Vector3(beam.position.x, beam.scale.y, beam.position.z);
  const row = terrain.rows.find((item) => item.id === `${event.owner}:life`); if (!row?.samples) return null; const t = Math.max(F.a, Math.min(F.b, event.start));
  const i = Math.max(0, Math.min(TNX - 1, Math.round(fracOf(F, t) * (TNX - 1)))); return new THREE.Vector3(X(t), row.samples[i] * row.scale * (row.amp ?? 1) * TAMP + 0.3, row.z);
}
let terrainArcTargets = [];
function drawTerrainArcs() {
  const buffer = terrain.arcs; buffer.begin(); terrainArcTargets = [];
  if (opt.edges && opt.show.has('causal')) for (const relation of causalAll) {
    const source = byId.get(relation.source); const target = byId.get(relation.target);
    if (!inView(source.start, 0.05) || !inView(target.start, 0.05) || !seen(relation, Math.max(source.start, target.start))) continue;
    const a = terrainPoint(source); const b = terrainPoint(target); if (!a || !b) continue; const lit4 = litArc?.relation === relation; const c = lit4 ? WHITE : color(KIND[relation.kind] ?? '#9a9a9a');
    const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 2 * TS + Math.abs(b.x - a.x) * 0.1, (a.z + b.z) / 2); const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(32);
    for (let i = 1; i < pts.length; i += 1) buffer.add(pts[i - 1].x, pts[i - 1].y, pts[i - 1].z, pts[i].x, pts[i].y, pts[i].z, c, lit4 ? 1 : 0.75);
    terrainArcTargets.push({ kind: 'arc', relation, source, target, pts: pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1) });
  }
  buffer.end();
}
// Terrain labels that would cover the time marks, the panels or each other lift a little; the rest wait for the pointer.
function declutterTerrain() {
  const placed = []; const panels = [...document.querySelectorAll('.hud.caption, .hud.bar, .hud.legend, .hud.title, .hud.stats, #tools, .pop:not([hidden]), #details:not([hidden])')].map((el) => el.getBoundingClientRect());
  const under = (r) => panels.some((p) => r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top);
  for (const el of labels.domElement.querySelectorAll('.label.year, .label.group, .label.group-count')) { el.style.opacity = ''; const r = el.getBoundingClientRect(); if (!r.width) continue; if (under(r)) { el.style.opacity = '0'; continue; } placed.push(r); }
  placed.push(...panels);
  for (const list of [terrain.sectionNames, terrain.ridgeNames]) {
    const items = []; for (const item of list) { if (!item.object.visible) continue; const r = item.object.element.getBoundingClientRect(); if (r.width) items.push([item, r]); }
    items.sort((a, b) => b[1].bottom - a[1].bottom);
    for (const [item, r] of items) { let lift = 0; const hit = () => placed.some((p) => r.left < p.right + 6 && r.right > p.left - 6 && r.top - lift < p.bottom + 1 && r.bottom - lift > p.top - 1);
      while (lift <= 64 && hit()) lift += 3; const fits = lift <= 64; item.inner.style.transform = `translateY(${-lift}px)`; item.inner.style.opacity = fits ? '' : '0'; if (fits) placed.push({ left: r.left, right: r.right, top: r.top - lift, bottom: r.bottom - lift }); }
  }
}

// How to show the run: its processes in one field (as the stage showed them), its tree in layers, or every function as
// terrain (as the landscape showed it). Each field keeps where its camera was.
function setLayout(layout) {
  if (layout === opt.layout) return; const toTerrain = layout === 'terrain'; const switching = toTerrain !== terrain.on;
  if (switching && opt.camera !== 'locked') poses[fieldKey()] = { position: camera.position.clone(), target: controls.target.clone() };
  opt.layout = layout; blend.to = layout === 'layers' ? 1 : 0;
  if (switching) {
    showTerrain(toTerrain);
    if (opt.camera !== 'locked') { const back = poses[fieldKey()] ?? homeOf(fieldKey()); camera.position.copy(back.position); controls.target.copy(back.target); if (!toTerrain && !poses.field) framed = HOME_FRAME; }
  }
  computeLayout(); syncPanel(); syncURL();
}
function showTerrain(on) {
  if (on && !terrain.built) { buildTerrain(); const d = terrain.depth; terrain.home = { position: new THREE.Vector3(-LENGTH * 0.36, 47 * TS, d * 0.62 + 56 * TS), target: new THREE.Vector3(12 * TS, 2 * TS, d * 0.05) }; terrain.homeDistance = terrain.home.position.distanceTo(terrain.home.target); }
  terrain.on = on; if (terrain.group) terrain.group.visible = on; field.visible = !on;
  renderer.toneMapping = on ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; renderer.toneMappingExposure = on ? 1.05 : 1;
  applyShine();
  if (opt.camera !== 'locked') { camera.fov = on ? 42 : 40; scene.fog.density = on ? TFOG : FOG; camera.updateProjectionMatrix(); }
  for (const id of ['depth-section', 'lenses-section']) document.getElementById(id).hidden = on || (id === 'lenses-section' && !lensList.length) || (id === 'depth-section' && !hasTree);
  for (const row of document.querySelectorAll('#kinds .toggle')) row.hidden = on && !TERRAIN_KINDS.has(row.dataset.key);
  if (!on) highlightRow(null); tip.hidden = true; statsShown = null; hud(); relayout = true; dirty = true;
}
// Hover on the terrain: what a beam, diamond or light is, else the ridge under the pointer and its time; that ridge stands out.
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let terrainLit = null; let hoveredAt = null;
function highlightRow(row) {
  if (row === terrainLit || !terrain.built) return; terrainLit = row;
  for (const other of terrain.rows) other.ridge.material.opacity = !row ? (other.kind === 'world' ? 0.55 : 0.9) : other === row ? 1 : 0.18;
  terrain.mesh.material.transparent = Boolean(row); terrain.mesh.material.opacity = row ? 0.55 : 1; terrain.mesh.material.needsUpdate = true;
}
function hoverTerrain() {
  if (!pointerAt) { highlightRow(null); hoveredAt = null; return; }
  if (hoveredAt && hoveredAt.x === pointerAt.x && hoveredAt.y === pointerAt.y) return; hoveredAt = { ...pointerAt };
  // A causal link under the pointer first, as in the processes.
  let arc = null; let bestArc = 8; for (const target of terrainArcTargets) for (let i = 1; i < target.pts.length; i += 1) { const a = screen(target.pts[i - 1].x, target.pts[i - 1].y, target.pts[i - 1].z); const b = screen(target.pts[i].x, target.pts[i].y, target.pts[i].z); if (!a.ok || !b.ok) continue; const d = distToSeg(pointerAt, a, b); if (d < bestArc) { bestArc = d; arc = target; } }
  if (arc !== litArc) { litArc = arc; drawTerrainArcs(); }
  if (arc) { highlightRow(null); renderer.domElement.style.cursor = 'help'; tip.replaceChildren(...arcLines(arc).map(([cls, text]) => tipLine(cls, text))); placeTip(); return; }
  ndc.set((pointerAt.x / innerWidth) * 2 - 1, -(pointerAt.y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const lines = []; let row = null;
  const hit = ray.intersectObjects([...terrain.beams, ...terrain.mind].filter((item) => item.visible), false)[0];
  if (hit) {
    const u = hit.object.userData; row = u.row ?? null;
    if (u.event) lines.push(['v', u.event.label], ['m', timeText(u.event.start, 2)], ['m', clip(u.event.description, 260)]);
    else if (u.decision) lines.push(['k', 'A decision'], ['v', u.decision.question], ...(u.decision.answers ?? []).slice(0, 5).map((answer) => ['m', `${Math.round(answer.weight * 100)}%  ${answer.key.replace(/[_.-]+/g, ' ')}${u.decision.drawn?.realized === answer.key ? '  ← drawn' : ''}`]));
    else if (u.node) lines.push(['k', NOTE[u.node.category]?.[0] ?? u.node.category], ['v', u.node.title || clip(u.node.text, 90)], ['m', clip(u.node.text, 360)]);
  } else {
    const ground = ray.intersectObject(terrain.mesh, false)[0];
    if (ground) { row = terrain.rows.reduce((best, other) => (Math.abs(other.z - ground.point.z) < Math.abs((best?.z ?? Infinity) - ground.point.z) ? other : best), null);
      if (row) { const u = ground.point.x / LENGTH + 0.5; const t = timeAt(F, u); lines.push(['k', row.group.label], ['v', row.label], ...terrainNumber(row, t, u), ['m', timeText(t, 2)]); } }
  }
  highlightRow(row);
  if (!lines.length) { tip.hidden = true; renderer.domElement.style.cursor = ''; return; }
  tip.replaceChildren(...lines.filter(([, text]) => text).map(([cls, text]) => tipLine(cls, text))); renderer.domElement.style.cursor = 'help'; placeTip();
}

// ---- playing: the story's years, or the model's construction ------------------------------------------------------------------
// Story time sweeps the years on screen, as the view always did. The construction replays the order the agent built the
// model and the graph, step by step, as the landscape replays it: the idle stretches between its calls are shortened.
const steps = (data.steps ?? []).filter((step) => Number.isFinite(Date.parse(step.at)));
const stepTimes = steps.map((step) => Date.parse(step.at)).sort((a, b) => a - b);
const C0 = stepTimes[0] ?? 0; const C1 = stepTimes.at(-1) ?? 1;
const activeClock = (() => {
  const sorted = [...new Set(stepTimes)]; const marks = [[sorted[0] ?? 0, 0]];
  for (let i = 1; i < sorted.length; i += 1) { const gap = sorted[i] - sorted[i - 1]; marks.push([sorted[i], marks[i - 1][1] + Math.min(gap, gap > 300000 ? 60000 : 300000)]); }
  const f = (t) => { if (t <= marks[0][0]) return 0; for (let i = 1; i < marks.length; i += 1) if (t <= marks[i][0]) { const [a, va] = marks[i - 1]; const [b, vb] = marks[i]; return va + ((t - a) / (b - a || 1)) * (vb - va); } return marks.at(-1)[1]; };
  f.invert = (v) => { if (v <= 0) return marks[0][0]; for (let i = 1; i < marks.length; i += 1) if (v <= marks[i][1]) { const [a, va] = marks[i - 1]; const [b, vb] = marks[i]; return a + ((v - va) / (vb - va || 1)) * (b - a); } return marks.at(-1)[0]; };
  f.total = marks.at(-1)[1] || 1; return f;
})();
let now = T1; let atEnd = true; let tau = C1; let playing = false; let timer = null;
const building = () => opt.mode === 'construction';
// Whether an item shows at the play position: in story time once its moment has come, in the construction once it was made.
const shownByPlay = (t, born) => (building() ? born <= tau : (atEnd && !playing) || !Number.isFinite(t) || t <= now);
const seen = (item, t) => shownByPlay(t, bornAt(item));
const month = (t) => new Date(Date.UTC(Math.floor(t), Math.floor((t % 1) * 12), 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// A moment in words: a month and year across history, a year before it, years ago in deep time.
const momentText = (t) => (PRESENT - t >= 5000 ? timeText(t) : t < 1000 ? yearText(Math.floor(t)) : month(t));
const setText = (id, text) => { const element = document.getElementById(id); if (element.textContent !== text) element.textContent = text; };
// Words without their markdown: a heading on a line of its own goes, a heading run into its text keeps its words.
const plain = (text) => String(text ?? '').replace(/^#{1,4}\s+[^\n]*\n/gm, ' ').replace(/^#{1,4}\s+/gm, '').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/\s+/g, ' ').trim();
const NOTE_NAMES = { root: 'Document', passage: 'Prose', thought: 'Thought', world: 'World stage', director: 'Director' };
const unitOf = new Map((data.story?.units ?? []).map((unit) => [unit.id, unit]));
// The numbers at the top: the story's totals, or, in the construction, what the agent had made so far.
let statsShown = null;
function showStats() {
  const made = (item) => !building() || bornAt(item) <= tau;
  if (terrain.on) {
    const nodesMade = data.graph.nodes.filter(made);
    const counts = [['Events', terrain.events.filter(made).length], ['Cuts', data.people.flatMap((person) => [...person.series.flatMap((series) => series.points), ...person.decisions]).filter(made).length],
      ['Functions', terrain.rows.filter((row) => !building() || row.born <= tau).length], ['Thoughts', nodesMade.filter((node) => node.category !== 'passage').length], ['Words of prose', nodesMade.reduce((sum, node) => sum + (node.words ?? 0), 0).toLocaleString('en-GB')]];
    const html = counts.map(([name, value]) => tile(name, value)).join(''); if (html !== statsShown) { document.getElementById('stats').innerHTML = html; statsShown = html; } return;
  }
  const counts = [['Processes', measures.filter(made).length], ['Events moving them', inStoryThreads.filter((thread) => made(thread.userData.event)).length], ['Causal links', causal.filter(made).length],
    ['Decisions drawn', decisions.filter((gem) => gem.userData.t >= T0 && gem.userData.t <= T1 && made(gem.userData.decision)).length], ['Love or fear', lenses.filter((chip) => made(chip.userData)).length]];
  const html = counts.map(([name, value]) => tile(name, value)).join(''); if (html !== statsShown) { document.getElementById('stats').innerHTML = html; statsShown = html; }
}
let readerShown = null;
function apply() {
  if (atEnd && !playing) now = F.b;
  const construction = building();
  for (const row of rows) {
    row.riseTo = construction && bornAt(row.measure) > tau ? 0 : 1;
    if (row.wall.visible) {
      let upto = NX; if (!construction && !(atEnd && !playing)) { let lo = 0; let hi = NX; while (lo < hi) { const mid = (lo + hi) >> 1; if (row.sampleT[mid] <= now) lo = mid + 1; else hi = mid; } upto = lo; }
      if (construction && row.rise < 0.002 && row.riseTo === 0) upto = 0;
      row.wall.geometry.setDrawRange(0, Math.max(0, (upto - 1) * 6)); row.crest.geometry.setDrawRange(0, upto);
    }
    row.value.element.textContent = format(row, valueAt(row.measure.points, Math.min(construction ? F.b : now, T1)));
    // In the construction a process the agent has not made yet keeps its name, faintly, and no value.
    const unmade = construction && !row.riseTo; row.value.element.style.visibility = unmade ? 'hidden' : ''; row.name.element.style.opacity = unmade ? '0.3' : '';
  }
  for (const thread of threads) {
    const on = opt.show.has('threads') && inView(thread.userData.t, 0.2) && (construction ? bornAt(thread.userData.event) <= tau : thread.userData.t <= now) && thread.userData.touched.some((row) => row.wall.visible);
    thread.visible = on; if (thread.userData.tag) thread.userData.tag.visible = on;
  }
  for (const gem of decisions) gem.visible = opt.show.has('decisions') && inView(gem.userData.t) && (construction ? bornAt(gem.userData.decision) <= tau : gem.userData.t <= now) && presence(frontOf(gem.userData.own)) > 0.5;
  // Across the story's years the love-or-fear chips before them wait at their start, as they always did.
  for (const chip of lenses) chip.visible = opt.show.has('lovefear') && (isStory() || inView(chip.userData.t)) && (construction ? bornAt(chip.userData) <= tau : chip.userData.t <= now) && presence(frontOf(chip.userData.own)) > 0.5;
  mind.visible = opt.show.has('notes');
  for (const light of notes) light.visible = light.userData.id === selectedPart?.unit.id || (construction ? bornAt(light.userData) <= tau : light.userData.t <= now);
  sweep.position.x = xOf(now); sweep.visible = playing && !construction;
  const fill = construction ? activeClock(tau) / activeClock.total : fracOf(F, now);
  document.getElementById('fill').style.width = `${Math.max(0, Math.min(1, fill)) * 100}%`;
  if (construction) {
    setText('clock', `${new Date(tau).toISOString().slice(11, 19)} UTC · ${Math.round(activeClock(tau) / 60000)} minutes of work`);
    // The newest of the agent's own words: its reason for a revision, or the thought, stage or prose it wrote.
    const step = steps.filter((item) => item.label && Date.parse(item.at) <= tau).at(-1);
    const newest = data.graph.nodes.filter((node) => NOTE_NAMES[node.category] && node.born?.at && Date.parse(node.born.at) <= tau).sort((a, b) => Date.parse(b.born.at) - Date.parse(a.born.at))[0];
    if (newest && (!step || Date.parse(newest.born.at) >= Date.parse(step.at))) {
      const unit = unitOf.get(newest.id); setText('kind', unit?.title ? `${NOTE_NAMES[newest.category]} · ${unit.title}` : NOTE_NAMES[newest.category]);
      setText('text', clip(plain(unit?.text ?? newest.text) || plain(newest.title ?? unit?.title), 330));
    } else { setText('kind', step ? `The agent · ${step.kind === 'model' ? 'model' : 'story graph'} revision ${step.rev}` : 'The construction'); setText('text', clip(step?.label ?? '', 330)); }
  } else {
    setText('clock', isStory() ? month(Math.min(now, T1 - 0.01)) : momentText(Math.min(now, F.b - 0.01)));
    const drawn = (thread) => Math.max(thread.userData.t, F.a);
    const latest = threads.filter((thread) => thread.userData.t <= now && inView(thread.userData.t, 0.2)).sort((a, b) => drawn(b) - drawn(a))[0];
    const currentParts = partsNow().map((i) => storyParts[i]);
    const partCaption = currentParts.length === 1 ? `Part ${currentParts[0].n}: ${currentParts[0].title}`
      : currentParts.length ? `Parts ${currentParts.map((part) => part.n).join(', ')}` : '';
    setText('kind', `${latest ? momentText(drawn(latest)) : 'The story'}${partCaption ? ` · ${partCaption}` : ''}`);
    setText('text', latest ? clip(`${latest.userData.event.label} ${latest.userData.event.description ?? ''}`, 330) : '');
  }
  showStats();
  // Keep the complete manuscript available through both playback clocks.
  if (!document.getElementById('reader').hidden) { const key = readerUnits().length; if (key !== readerShown) renderReader(); }
  applyTerrain(); drawNotes(); drawArcs(); syncStrip(); extrasDirty = true;
}
function stop() { playing = false; clearInterval(timer); setText('play', '▶'); apply(); syncURL(); }
function play() {
  playing = true; setText('play', '❚❚');
  if (building()) {
    if (atEnd || tau >= C1) { tau = C0; for (const row of rows) row.rise = bornAt(row.measure) <= C0 ? 1 : 0; }
    atEnd = false;
    const step = activeClock.total / (48000 / 60);
    timer = setInterval(() => { tau = Math.min(C1, activeClock.invert(Math.min(activeClock.total, activeClock(tau) + step * opt.speed))); apply(); if (tau >= C1) { atEnd = true; stop(); } }, 60);
  } else {
    if (atEnd || now >= F.b) now = F.a; atEnd = false;
    // 45 seconds across the window. Across years the play steps evenly in time, as it always did; on a log scale it steps
    // evenly across the screen.
    timer = setInterval(() => {
      if (F.w) { const u = Math.min(1, fracOf(F, now) + opt.speed / 900); now = u >= 1 ? F.b : timeAt(F, u); } else now = Math.min(F.b, now + ((F.b - F.a) / (45000 / 50)) * opt.speed);
      apply(); if (now >= F.b) { atEnd = true; stop(); }
    }, 50);
  }
}
document.getElementById('play').addEventListener('click', () => (playing ? stop() : play()));
const seekTo = (fraction) => {
  const f = Math.max(0, Math.min(1, fraction)); atEnd = f >= 1;
  if (building()) tau = activeClock.invert(f * activeClock.total); else now = f >= 1 ? F.b : F.w ? timeAt(F, f) : F.a + f * (F.b - F.a);
  apply();
};
{ const track = document.getElementById('track'); let scrubbing = false; const at = (e) => { const r = track.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
  track.addEventListener('pointerdown', (e) => { stop(); scrubbing = true; track.setPointerCapture(e.pointerId); seekTo(at(e)); });
  track.addEventListener('pointermove', (e) => { if (scrubbing) seekTo(at(e)); });
  const end = () => { if (scrubbing) { scrubbing = false; syncURL(); } }; track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end); }

// ---- the camera: spinning (the view as it always turned), free, or locked to a steady framing ---------------------------------
// Locked is the explorer's framing: from the front and above, nearly flat, the whole view in the part of the window the
// title, the numbers, the legend or the panel and the play bar leave free.
const LOCKED = { fov: 17, elevation: 0.8, pose: null, scroll: 0 };
const HOME_DISTANCE = HOME.position.distanceTo(HOME.target); const FOG = 0.0048;
function freeRoom() {
  const title = document.querySelector('.hud.title').getBoundingClientRect(); const stats = document.getElementById('stats').getBoundingClientRect(); const bar = document.querySelector('.hud.bar').getBoundingClientRect();
  const side = [document.getElementById('details'), document.getElementById('legend')].map((el) => el.getBoundingClientRect()).find((r) => r.width && r.left > innerWidth * 0.5);
  const tools = document.getElementById('tools').getBoundingClientRect();
  const caption = document.querySelector('.hud.caption').getBoundingClientRect();
  return { l: 28, r: side ? side.left - 20 : innerWidth - 28, t: Math.min(Math.max(title.bottom, stats.bottom, tools.bottom) + 24, innerHeight * 0.35), b: (caption.height ? caption.top : bar.top || innerHeight - 66) - 16 };
}
// The whole view fits the free room when it can. A tall one (a deep tree in layers) is never shrunk below three quarters
// of the size that fills the width: it runs on below, and scrolls (shift and scroll, drag up and down, or the arrow keys).
function fitLocked() {
  const box = boundsNow(); const center = new THREE.Vector3(0, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2);
  const dir = new THREE.Vector3(0, Math.sin(LOCKED.elevation), Math.cos(LOCKED.elevation)); const room = freeRoom();
  // The names on the left and the values on the right keep their width in pixels, whatever the distance.
  const width = (elements) => Math.max(0, ...elements.map((el) => el.offsetWidth || 0));
  if (terrain.on) { room.l += width(terrain.groupNames.map((item) => item.element)) || 140; room.r -= width(terrain.sectionNames.map((item) => item.object.element)) || 170; }
  else { room.l += width([...rows.map((row) => row.name.element), ...groupLabels.map((item) => item.object.element), laneTag.element]) || 180; room.r -= width(rows.map((row) => row.value.element)) || 70; }
  const corners = []; for (const x of [-LENGTH / 2 - 1.2, LENGTH / 2 + 1.2]) for (const y of [box.y0, box.y1]) for (const zz of [box.z0, box.z1]) corners.push(new THREE.Vector3(x, y, zz));
  const probe = new THREE.PerspectiveCamera(LOCKED.fov, innerWidth / innerHeight, 0.1, 10000);
  const measure = (d) => { probe.position.copy(center).addScaledVector(dir, d); probe.lookAt(center); probe.updateMatrixWorld();
    const pts = corners.map((p) => p.clone().project(probe)); const sx = pts.map((p) => (p.x + 1) / 2 * innerWidth); const sy = pts.map((p) => (1 - p.y) / 2 * innerHeight);
    return { l: Math.min(...sx), r: Math.max(...sx), t: Math.min(...sy), b: Math.max(...sy) }; };
  const nearest = (fits) => { let lo = 20; let hi = 4000; for (let i = 0; i < 36; i += 1) { const d = (lo + hi) / 2; if (fits(measure(d))) hi = d; else lo = d; } return hi; };
  const W = room.r - room.l; const H = room.b - room.t;
  const d = Math.min(nearest((m) => m.r - m.l <= W && m.b - m.t <= H), nearest((m) => m.r - m.l <= W) * 1.35); const m = measure(d);
  const overflow = Math.max(0, m.b - m.t - H);
  LOCKED.pose = { center, d, position: center.clone().addScaledVector(dir, d), ox: (m.l + m.r) / 2 - (room.l + room.r) / 2, oy: overflow ? m.t - room.t : (m.t + m.b) / 2 - (room.t + room.b) / 2, overflow };
  LOCKED.scroll = Math.max(0, Math.min(overflow, LOCKED.scroll ?? 0));
}
const scrollLocked = (dy) => { if (!LOCKED.pose?.overflow) return; const next = Math.max(0, Math.min(LOCKED.pose.overflow, LOCKED.scroll + dy)); if (next !== LOCKED.scroll) { LOCKED.scroll = next; dirty = true; } };
function placeLocked(jump = false) {
  if (!LOCKED.pose) fitLocked(); const pose = LOCKED.pose;
  if (jump) { camera.position.copy(pose.position); controls.target.copy(pose.center); }
  // The fog and the far plane follow the distance, so the view reads as it does up close.
  camera.fov = LOCKED.fov; camera.far = Math.max(900, pose.d * 4); scene.fog.density = terrain.on ? TFOG * (terrain.homeDistance / pose.d) : FOG * (HOME_DISTANCE / pose.d);
  camera.setViewOffset(innerWidth, innerHeight, pose.ox, pose.oy + (LOCKED.scroll ?? 0), innerWidth, innerHeight); camera.lookAt(pose.center); camera.updateProjectionMatrix();
}
// Where the turning camera was in each field (the processes and the tree, or the terrain), to come back to.
const poses = {}; const fieldKey = () => (terrain.on ? 'terrain' : 'field');
const homeOf = (key) => (key === 'terrain' ? terrain.home : HOME);
// A turning camera keeps its framing as the field grows or shrinks (the tree added in Together, or Layers): it steps back
// as far as the field has grown and follows its centre. The field as the stage showed it is the camera as it always was.
// The thoughts above do not count: the camera is the same with them or without.
function fieldFrame() {
  const m = smooth(blend.now); const layers = layersBounds && m > 0.01;
  const below = Math.min(0, ...nodes.filter((node) => node.inT && presence(node) > 0.5).map((node) => node.yT));
  const z0 = Math.min(zBackNow(), layers ? layersBounds.z0 : Infinity); const z1 = Math.max(laneAt().z, zFrontNow()); const y0 = Math.min(layers ? layersBounds.y0 * m : 0, below * (1 - m));
  return { size: Math.hypot(LENGTH * 0.6, z1 - z0, (AMP - y0) * 1.5), cz: (z0 + z1) / 2, cy: (y0 + AMP) / 2 };
}
const HOME_FRAME = { size: Math.hypot(LENGTH * 0.6, zFront + 6.5 - zBack, AMP * 1.5), cz: (zBack + zFront + 6.5) / 2, cy: AMP / 2 };
let framed = HOME_FRAME;
function reframe() {
  if (opt.camera === 'locked' || terrain.on) return;
  const now2 = fieldFrame();
  const k = now2.size / framed.size; const dz = now2.cz - framed.cz; const dy = now2.cy - framed.cy; framed = now2;
  if (Math.abs(k - 1) < 1e-9 && Math.abs(dz) < 1e-9 && Math.abs(dy) < 1e-9) return;
  const offset = camera.position.clone().sub(controls.target).multiplyScalar(k); controls.target.z += dz; controls.target.y += dy; camera.position.copy(controls.target).add(offset);
}
function setCamera(mode, first = false) {
  const was = opt.camera; opt.camera = mode; controls.autoRotate = mode === 'spin'; controls.enabled = mode !== 'locked';
  renderer.domElement.classList.toggle('locked', mode === 'locked');
  if (mode === 'locked') { if (was !== 'locked' && !first) poses[fieldKey()] = { position: camera.position.clone(), target: controls.target.clone() }; fitLocked(); placeLocked(true); }
  else if (was === 'locked' || first) {
    camera.clearViewOffset(); camera.fov = terrain.on ? 42 : 40; camera.far = 900; scene.fog.density = terrain.on ? TFOG : FOG; camera.updateProjectionMatrix();
    if (was === 'locked' && !first) { const back = poses[fieldKey()] ?? homeOf(fieldKey()); camera.position.copy(back.position); controls.target.copy(back.target); if (!poses.field && !terrain.on) framed = HOME_FRAME; reframe(); }
  }
  document.getElementById('camera-note').textContent = mode === 'locked' ? 'A steady framing. Scroll or pinch zooms in time, drag pans; A and D move through time, W and S zoom it.' : `${mode === 'free' ? 'Held where you leave it.' : 'Turning slowly, as it always did.'} Drag to turn it, right-drag to move it, scroll to come closer to what is under the pointer. W A S D walk through it, Q and E go down and up, the arrows look around, Shift goes faster.`;
  syncPanel(); syncURL(); dirty = true;
}
// The camera's pose, kept in the URL when it is free.
controls.addEventListener('end', () => { if (opt.camera === 'free') syncURL(); });
// The space the view's content takes now, for framing it.
function boundsNow() {
  if (terrain.on) return { y0: -1, y1: TAMP + 14 * TS, z0: terrain.zMin - 1, z1: terrain.zMax + 3 };
  const m = smooth(blend.now); const zs = [zBackNow(), zFrontNow() + 2.2, laneAt().z]; const ys = [0, AMP + 2.2];
  if (layersBounds && m > 0.01) { zs.push(layersBounds.z0, layersBounds.z1 + 2.2); ys.push(layersBounds.y0, layersBounds.y1 + LAMP); }
  if (opt.show.has('notes')) { const top = mindTop(); const layer = Math.max(0, ...graphNodes.map(noteLayer)); ys.push(top.y + layer * 1.6 + 3); zs.push(top.z - layer * 2.2 - 1); }
  return { y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1, z0: Math.min(...zs) - 2, z1: Math.max(...zs) + 3 };
}

// ---- zoom and pan in time --------------------------------------------------------------------------------------------------------
let animation = null;
const lives = principals.filter((person) => person.life).map((person) => ({ name: person.name.split(' ')[0], start: person.life.start, end: person.life.end }));
let lifeTurn = Math.max(0, lives.findIndex((life) => life.name.toLowerCase() === String(params.get('life') ?? '').toLowerCase()));
const centuries = (() => { const starts = treeEvents.filter((event) => event.depth === 1 && event.reach[0] >= 1000).map((event) => event.reach[0]); return starts.length ? Math.min(...starts) : PRESENT - 600; })();
const PRESETS = {
  story: () => [T0, T1],
  life: () => { const life = lives[lifeTurn % lives.length] ?? { start: PRESENT - 80, end: PRESENT }; const pad = (life.end - life.start) * 0.04; return [life.start - pad, Math.min(BOUNDS[1], life.end + pad)]; },
  centuries: () => [centuries - (PRESENT - centuries) * 0.04, BOUNDS[1]],
  world: () => [BOUNDS[0], BOUNDS[1]],
};
let currentPreset = ['story', 'life', 'centuries', 'world'].includes(params.get('zoom')) ? params.get('zoom') : (params.has('t0') ? null : 'story');
function setView(a, b) { F = frameOf(a, b); tabulate(); relayout = true; dirty = true; }
function animateTo(a, b, ms = 1400) {
  const fromG = [G(F.a), G(F.b)]; const toG = [G(a), G(b)]; const t0 = performance.now();
  animation = (clock) => { const k = smooth(Math.min(1, (clock - t0) / ms)); setView(Ginv(fromG[0] + (toG[0] - fromG[0]) * k), Math.min(BOUNDS[1], Ginv(fromG[1] + (toG[1] - fromG[1]) * k))); if (k >= 1) { animation = null; setView(a, b); syncURL(); } };
}
function preset(name, animate = true) {
  if (name === 'life' && animate && currentPreset === 'life') lifeTurn += 1;
  currentPreset = name; const [a, b] = PRESETS[name](); if (animate) animateTo(a, b); else setView(a, b); syncPanel();
}
const clearPreset = () => { currentPreset = null; syncPanel(); };
// The time under a point on screen: where its ray meets the ground of the rows.
function pointerTime(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1); const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) ?? ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3()) ?? new THREE.Vector3();
  const u = hit.x / LENGTH + 0.5; return { u, t: timeAt(F, u) };
}
function zoomAt(clientX, clientY, factor) { animation = null; clearPreset(); const { u, t } = pointerTime(clientX, clientY); const [a, b] = windowAt(t, u, F.s / factor); setView(a, b); syncURL(); }
{ const canvas = renderer.domElement; let drag = null; const touches = new Map(); let pinch = null;
  canvas.addEventListener('wheel', (event) => {
    if (opt.camera !== 'locked' && !event.shiftKey) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const dy = (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : 1);
    if (opt.camera === 'locked' && event.shiftKey && !event.ctrlKey) { scrollLocked(dy); return; }
    if (opt.camera === 'locked' && Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) { const { u, t } = pointerTime(event.clientX, event.clientY); const [a, b] = windowAt(t, u + event.deltaX / innerWidth, F.s); animation = null; clearPreset(); setView(a, b); syncURL(); return; }
    zoomAt(event.clientX, event.clientY, Math.exp(-dy * (event.ctrlKey ? 0.012 : 0.0016)));
  }, { passive: false, capture: true });
  canvas.addEventListener('pointerdown', (event) => {
    if (opt.camera !== 'locked') return; canvas.setPointerCapture(event.pointerId); touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 1) { const { u, t } = pointerTime(event.clientX, event.clientY); drag = { t, u, x: event.clientX, y: event.clientY, scroll: LOCKED.scroll ?? 0, moved: false }; }
    else { drag = null; const [p, q] = [...touches.values()]; pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2 }; }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (opt.camera !== 'locked') return;
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) { const [p, q] = [...touches.values()]; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d > 10) { zoomAt(pinch.cx, pinch.cy, d / pinch.d); pinch.d = d; } return; }
    if (!drag) return; if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) { drag.moved = true; canvas.classList.add('dragging'); }
    if (drag.moved) {
      if (Math.abs(event.clientX - drag.x) > 1) { const u = drag.u + (event.clientX - drag.x) / (innerWidth * 0.8); animation = null; clearPreset(); const [a, b] = windowAt(drag.t, u, F.s); setView(a, b); }
      scrollLocked(drag.scroll - (event.clientY - drag.y) - LOCKED.scroll);
    }
  });
  const release = (event) => { touches.delete(event.pointerId); if (touches.size < 2) pinch = null; if (drag?.moved) syncURL(); drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('dblclick', (event) => {
    const item = litNode ?? (litReading ? nodeById.get(litReading.eventId) : null); clearPreset();
    if (!item) { if (opt.camera === 'locked') zoomAt(event.clientX, event.clientY, 2.5); return; }
    const span = Math.max(0.012, (item.t1 - item.t0) * 1.25); const [a, b] = windowAt((item.t0 + item.t1) / 2, 0.5, span); animateTo(a, b, 1100);
  });
}

// ---- HUD ------------------------------------------------------------------------------------------------------------------
const titleText = params.get('title') ?? data.title ?? 'Processes';
fillLinks(document.getElementById('repos'), data);
document.getElementById('title').textContent = titleText; document.title = titleText;
const inStoryThreads = threads.filter((thread) => thread.userData.t >= T0 - 0.2 && thread.userData.t <= T1);
const FIELD_SUB = `${measures.length} processes the agent modeled for the story, each on its own scale, `
  + `and the ${inStoryThreads.length} events that move them. The heights interpolate samples parsed from each process's source wording.`;
document.getElementById('sub').textContent = FIELD_SUB;
const tile = (name, value) => `<div class="stat"><div class="value">${value}</div><div class="name">${name}</div></div>`;
showStats();
const keyRow = (glyph, text) => `<div class="key-row"><span class="glyph">${glyph}</span><span>${text}</span></div>`;
const FIELD_LEGEND = '<div class="key-head">How to read it</div>'
  + keyRow('<svg width="28" height="14"><path d="M1 12 C8 12 9 3 15 4 S23 9 27 2" stroke="#9fc3ff" stroke-width="2" fill="none"/></svg>', 'A curtain is one process over the years, on its own scale; the value is on the right')
  + keyRow('<svg width="10" height="16"><line x1="5" y1="1" x2="5" y2="15" stroke="#fff" stroke-width="2"/></svg>', 'A thread is an event, through every process it moves')
  + keyRow('<svg width="14" height="14"><path d="M7 1 L13 7 L7 13 L1 7Z" fill="#fff"/></svg>', 'A diamond is a decision the model drew from its weights')
  + keyRow('<svg width="28" height="8"><rect width="15" height="8" rx="3" fill="#ffb057"/><rect x="15" width="10" height="8" fill="#58b4ff"/></svg>', 'How much of an act comes from love and how much from fear')
  + keyRow('<svg width="28" height="12"><path d="M1 11 Q14 -4 27 11" stroke="#ff8a4c" stroke-width="2" fill="none"/></svg>', 'An arc is a causal link from one event to another: causes, enables, fulfils a forecast')
  + keyRow('<svg width="16" height="16"><circle cx="8" cy="8" r="4" fill="#c9d4ff"/><circle cx="8" cy="8" r="7.5" fill="none" stroke="#c9d4ff" stroke-opacity="0.35"/></svg>', `Documents & notes shows ${notes.length} book, passage and note nodes above the processes. A selected passage is labeled; its gold links point to the Events it depicts`);

// ---- the story, as the tool renders it from the graph ------------------------------------------------------------------------
const setLegend = (html, names = groups.map((group) => [group.label, group.hue])) => {
  const legend = document.getElementById('legend');
  legend.innerHTML = html;
  appendLegendNames(legend, names);
};
setLegend(FIELD_LEGEND);
// The terrain's own words: what its ridges, beams, diamonds and lights are, and how many functions rise.
function hud() {
  if (!terrain.on) { document.getElementById('sub').textContent = FIELD_SUB; setLegend(FIELD_LEGEND); showStats(); return; }
  document.getElementById('sub').textContent = `${terrain.persons.map((person) => person.name).join(', ')}. ${terrain.rows.length} functions over time, each the model's own record, rising in the order the agent built them.`;
  const svg = (inner) => `<svg width="30" height="16">${inner}</svg>`;
  setLegend('<div class="key-head">How to read it</div>'
    + keyRow(svg('<path d="M1 14 C 7 14, 9 3, 14 5 S 22 12, 29 2" fill="none" stroke="#c3c2b7" stroke-width="2"/>'), 'A ridge is one function of the model over time')
    + keyRow(svg('<rect x="14" y="1" width="2" height="14" fill="#c3c2b7"/>'), 'A beam is an Event: something that happens')
    + keyRow(svg('<path d="M15 1 L21 8 L15 15 L9 8 Z" fill="#c3c2b7"/>'), 'A diamond is a decision; it glows once the model has drawn it')
    + keyRow(svg('<circle cx="15" cy="8" r="5" fill="#c9d4ff" opacity="0.9"/>'), 'Lights above are document and note nodes; their links attach them to the world'),
    [...terrain.persons.map((person, i) => [person.name, HUES[i % HUES.length]]), ['the world', WORLD]]);
  showStats();
}
const inline = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
// Reading always opens the complete manuscript; neither playback clock filters the text.
const readerUnits = () => data.story?.units ?? [];
function renderReader(unitId = null) {
  const body = document.getElementById('reader-body'); body.replaceChildren(); let target = null; const units = readerUnits(unitId); readerShown = units.length;
  for (const unit of units) unit.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).forEach((block, i) => {
    const heading = block.match(/^(#{1,4})\s+([\s\S]*)$/);
    const element = document.createElement(heading ? `h${heading[1].length}` : 'p');
    element.innerHTML = inline(heading && heading[1].length === 1 && unit.role === 'document_root' ? titleText : heading ? heading[2] : block).replace(/\n/g, '<br>'); body.append(element);
    if (unit.id === unitId && i === 0) target = element;
  });
  const part = storyParts.find((item) => item.unit.id === unitId);
  document.getElementById('reader-status').textContent = part ? `Full story · Part ${part.n} of ${storyParts.length}` : `Full story · All ${storyParts.length} parts`;
  if (target) target.scrollIntoView({ block: 'start' }); else document.getElementById('reader').scrollTop = 0;
}
document.getElementById('read').addEventListener('click', () => { document.getElementById('reader').hidden = false; renderReader(); });
document.getElementById('reader-start').addEventListener('click', () => renderReader());
document.getElementById('reader-close').addEventListener('click', () => { document.getElementById('reader').hidden = true; });
addEventListener('keydown', (event) => { if (event.key === 'Escape') document.getElementById('reader').hidden = true; });
// Full view: the story across the whole window. Download: the whole story as the Meaning Model renders it, as Markdown.
const readerPanel = document.getElementById('reader');
function fullReader(on) { readerPanel.classList.toggle('full', on); setText('reader-full', on ? 'Side view' : 'Full view'); syncURL(); }
document.getElementById('reader-full').addEventListener('click', () => fullReader(!readerPanel.classList.contains('full')));
addEventListener('keydown', (event) => { if ((event.key === 'f' || event.key === 'F') && !readerPanel.hidden && !event.metaKey && !event.ctrlKey) fullReader(!readerPanel.classList.contains('full')); });
document.getElementById('reader-download').addEventListener('click', () => {
  const units = data.story?.units ?? []; const markdown = `${units.map((unit) => String(unit.text ?? '').trim()).filter(Boolean).join('\n\n')}\n`;
  const slug = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const own = units.find((unit) => unit.role === 'document_root')?.text?.match(/^#\s+(.+)$/m)?.[1] ?? titleText; const story = document.getElementById('story');
  const name = [slug(own), story.hidden ? null : slug(story.selectedOptions?.[0]?.textContent)].filter(Boolean).join('-') || 'story';
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })); link.download = `${name}.md`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
});


// ---- the story's own time: its parts in reading order -----------------------------------------------------------------------------
// The reading track follows render order and prose length. Its selection is independent of both playback clocks.
// Selecting a part inspects its document and declared links without moving world or construction time.
const storyParts = measureStoryUnits((data.story?.units ?? []).filter((unit) => unit.role !== 'document_root' && String(unit.text ?? '').trim()), data.events)
  .map((part, i) => ({ ...part, n: i + 1, title: String(part.unit.title ?? '').replace(/^[A-Za-z]+:\s*/, '') || `Part ${i + 1}` }));
const totalProseWords = storyParts.at(-1)?.wordEnd ?? 0;
const proseNumber = (n) => n.toLocaleString('en-GB');
let overStrip = false; let partShown;
function selectReadingPart(part) {
  if (!part) return;
  selectStoryPart(part); tip.hidden = true; overStrip = false; pointerAt = null;
}
function stepReadingPart(direction) {
  const index = selectedPart ? storyParts.indexOf(selectedPart) : -1;
  selectReadingPart(storyParts[index + direction]);
}
document.getElementById('reading-prev').addEventListener('click', () => stepReadingPart(-1));
document.getElementById('reading-next').addEventListener('click', () => stepReadingPart(1));
if (storyParts.length) {
  document.getElementById('strip').hidden = false; document.body.classList.add('has-strip');
  for (const part of storyParts) {
    const button = document.createElement('button'); button.className = 'part'; button.style.flex = `${Math.max(1, part.words)} 1 0`; button.textContent = String(part.n); part.el = button;
    button.title = `Part ${part.n}: ${part.title} · ${proseNumber(part.words)} prose words`; button.setAttribute('aria-label', button.title);
    button.addEventListener('mousemove', (event) => { overStrip = true; showPartTip(part, event); }); button.addEventListener('mouseleave', () => { overStrip = false; tip.hidden = true; });
    button.addEventListener('click', () => selectReadingPart(part)); document.getElementById('parts').append(button);
  }
}
document.getElementById('reading-track').hidden = !storyParts.length;
if (appendDocumentSpans(document.getElementById('strip'), data.documentProjection)) {
  document.getElementById('strip').hidden = false; document.body.classList.add('has-strip');
}
function partsNow() {
  if (building()) { let at = -1; storyParts.forEach((part, i) => { if (bornAt(part.unit) <= tau) at = i; }); return at < 0 ? [] : [at]; }
  if (atEnd && !playing) return [];
  return partsAtTime(storyParts.map((part) => part.unit), now);
}
function syncStrip() {
  const key = selectedPart?.unit.id ?? ''; if (key === partShown) return; partShown = key;
  storyParts.forEach((part) => { part.el.classList.toggle('selected', part === selectedPart); part.el.setAttribute('aria-pressed', String(part === selectedPart)); });
  document.getElementById('reading-current').textContent = selectedPart ? `${selectedPart.n} of ${storyParts.length} · ${selectedPart.title}` : `Choose one of ${storyParts.length} parts`;
  document.getElementById('reading-position').textContent = selectedPart
    ? selectedPart.words ? `Prose words ${proseNumber(selectedPart.wordStart + 1)}–${proseNumber(selectedPart.wordEnd)} / ${proseNumber(totalProseWords)}` : `No prose words · boundary ${proseNumber(selectedPart.wordStart)} / ${proseNumber(totalProseWords)}`
    : `${proseNumber(totalProseWords)} prose words`;
  document.getElementById('reading-prev').disabled = !selectedPart || selectedPart.n <= 1;
  document.getElementById('reading-next').disabled = !storyParts.length || selectedPart?.n === storyParts.length;
}
function partLines(part, hint = true, includeEvents = false) {
  const { timing } = part; const [a, b] = timing.range ?? [null, null];
  const tells = [...new Set((part.unit.tells ?? []).map((tell) => tell.eventId))].map((id) => ({ id, event: byId.get(id) }));
  const relative = {
    before: "Linked date range is entirely before the previous part's.",
    after: "Linked date range is entirely after the previous part's.",
    overlap: 'Linked date ranges overlap; Event order within the prose is not declared.',
    unknown: 'Time relative to the previous part is unknown: one or both lacks complete linked dates.',
  }[part.relativeToPrevious];
  const coverage = `${timing.dated} of ${timing.linked} linked Events have complete dates`
    + (timing.undated ? ` · ${timing.undated} undated or partly dated` : '')
    + (timing.missing ? ` · ${timing.missing} unavailable` : '');
  const eventTime = (event) => !event ? 'Unavailable' : !Number.isFinite(event.start) ? 'Undated'
    : `${timeText(event.start, 2)}${Number.isFinite(event.end) ? event.end > event.start ? ` to ${timeText(event.end, 2)}` : '' : ' · end undated'}`;
  return [['k', `Part ${part.n} of ${storyParts.length} · ${part.words.toLocaleString('en-GB')} prose words`], ['v', part.unit.title || part.title],
    ['m', timing.range ? `Dated linked Events: ${month(a)}${b > a ? ` to ${month(b)}` : ''}`
      : timing.linked ? 'No complete linked Event dates are available' : 'World time is unlinked; this part remains in reading order'],
    ...(timing.linked ? [['a', coverage]] : []),
    ...(timing.dated > 1 ? [['a', 'Earliest to latest linked date; gaps may occur between Events.']] : []),
    ...(relative ? [['a', relative]] : []),
    ...(includeEvents && tells.length ? [['a', 'Events linked as depicted by this part:'], ...tells.map(({ id, event }) => ['num-line', `${eventTime(event)}: ${clip(event?.label ?? id, 90)}`])] : []),
    ...(hint ? [['a', 'Click to select this document and inspect its links. The graph and time stay in place.']] : [])];
}
function showPartTip(part, event) {
  tip.replaceChildren(...partLines(part).map(([cls, text]) => tipLine(cls, text))); tip.hidden = false; const w = tip.offsetWidth; const h = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 12, Math.max(12, event.clientX - w / 2))}px`; tip.style.top = `${Math.max(12, event.clientY - h - 18)}px`;
}
function selectStoryPart(part) {
  stop(); selectedPart = part; selectedEventIds.clear();
  for (const tell of part.unit.tells ?? []) selectedEventIds.add(tell.eventId);
  document.getElementById('reader').hidden = true;
  showThoughts(true); apply(); syncStrip(); extrasDirty = true;
  const read = document.createElement('button'); read.className = 'tool part-read'; read.textContent = 'Read this part';
  read.addEventListener('click', () => { document.getElementById('reader').hidden = false; renderReader(part.unit.id); });
  const partInfo = partLines(part, false);
  const lines = partInfo.slice(0, 2).map(([cls, text]) => tipLine(cls, text));
  lines.push(read, tipLine('a', terrain.on
    ? 'This passage is highlighted above the terrain. World time is unchanged.'
    : 'Gold links connect this passage to the Events it depicts. World time is unchanged.'));
  const disclosure = document.createElement('details'); disclosure.className = 'part-events';
  const summary = document.createElement('summary'); summary.textContent = `Linked Events (${part.timing.linked})`; disclosure.append(summary);
  disclosure.append(tipLine('a', `Document node: ${part.unit.id}`));
  for (const [cls, text] of partInfo.slice(2)) disclosure.append(tipLine(cls, text));
  if (terrain.on) {
    const connections = document.createElement('button'); connections.className = 'tool part-read'; connections.textContent = 'Show connections in Processes';
    connections.addEventListener('click', () => { setLayout('together'); selectStoryPart(part); }); disclosure.append(connections);
  }
  for (const [cls, text] of partLines(part, false, true).filter(([cls]) => cls === 'num-line')) disclosure.append(tipLine(cls, text));
  lines.push(disclosure);
  showDetails(lines);
}
if (params.has('read')) { document.getElementById('read').click(); if (params.get('read') === 'full') fullReader(true); }

const thoughtsButton = document.getElementById('thoughts');
const showThoughts = (on) => { if (on) opt.show.add('notes'); else opt.show.delete('notes'); mind.visible = on; thoughtsButton.classList.toggle('on', on); thoughtsButton.textContent = on ? 'Hide documents & notes' : 'Documents & notes'; if (!on) tip.hidden = true; syncPanel(); syncURL(); dirty = true; };
thoughtsButton.addEventListener('click', () => showThoughts(!mind.visible)); showThoughts(mind.visible);

// The bundled local viewer does not offer QR-code hosting.
const qrPanel = document.getElementById('qr-panel');
qrPanel.hidden = true; document.getElementById('qr').hidden = true;
if (data.constructionTiming === 'unavailable') document.querySelector('[data-mode="construction"]')?.remove();

// ---- the toolbar ------------------------------------------------------------------------------------------------------------------
const KINDS = [
  ['processes', 'Named processes', '#9fc3ff', () => measures.length],
  ['threads', 'Events moving them', '#ffffff', () => threads.length],
  ['decisions', 'Decisions', '#ffffff', () => decisions.length],
  ['lovefear', 'Love or fear of the acts', '#ffb057', () => lenses.length],
  ['causal', 'Causal links', '#ff8a4c', () => causalAll.length],
  ['notes', 'Documents & notes', '#c9d4ff', () => notes.length],
  ['events', 'The tree of Events', '#e9e8e2', () => nodes.filter((node) => node.kind === 'event').length],
  ['subsidiary', 'Subsidiary processes', '#b9aefc', () => nodes.filter((node) => node.kind === 'sub').length],
  ['prose', 'Prose, part by part', '#fff0d0', () => prose.length],
];
const depthNote = { 0: 'The world alone.', 1: 'The world and what it holds: long developments, lives, places and institutions.', 2: 'With the periods, change arcs and parts of each.', 3: 'With the phases of each change and the moments in them.', 4: 'With the moments within moments.', 5: 'Deeper still.', 6: 'The whole tree.' };
// The toolbar, the legend and what was clicked stand together on the right.
const panel = document.getElementById('side');
// Each control of the toolbar opens its choices below it, one at a time; a click elsewhere or Escape closes them.
let popOpen = null;
function fitOpenPanels() {
  for (const panel of document.querySelectorAll('.pop:not([hidden]), #details:not([hidden])')) {
    panel.style.maxHeight = `${Math.max(0, innerHeight - panel.getBoundingClientRect().top - 12)}px`;
  }
}
addEventListener('resize', fitOpenPanels);
function togglePop(id) {
  popOpen = popOpen === id ? null : id;
  for (const pop of document.querySelectorAll('.pop')) pop.hidden = pop.id !== popOpen;
  for (const button of document.querySelectorAll('.tool[data-pop]')) button.classList.toggle('open', button.dataset.pop === popOpen);
  fitOpenPanels();
}
for (const button of document.querySelectorAll('.tool[data-pop]')) button.addEventListener('click', () => togglePop(button.dataset.pop));
document.addEventListener('pointerdown', (event) => { if (popOpen && !event.target.closest?.('.tool-wrap')) togglePop(popOpen); });
addEventListener('keydown', (event) => { if (event.key === 'Escape' && popOpen) togglePop(popOpen); });
// Which story: every run the viewer has open, the one an agent worked on last first. Choosing one opens the view on it,
// keeping how it is shown.
fetch('data/index.json', { cache: 'no-store' }).then((response) => response.json()).then((index) => {
  const runs = [...(index.runs ?? [])].sort((a, b) => String(b.lastCall ?? '').localeCompare(String(a.lastCall ?? ''))); if (runs.length < 2) return;
  const select = document.getElementById('story'); select.hidden = false;
  for (const run of runs) { const option = document.createElement('option'); option.value = run.name; option.textContent = run.label ?? run.title ?? run.name; option.selected = run.name === dataName; select.append(option); }
  select.addEventListener('change', () => {
    const next = new URLSearchParams(location.search); next.set('data', select.value); for (const key of ['at', 'pose', 'focus', 'lenses']) next.delete(key);
    location.search = next.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/\+/g, '%20').replace(/=(&|$)/g, '$1');
  });
}).catch(() => { /* one run, or none to choose from */ });
// Shining, or less shining: the full glare of the stage or a quieter one.
function applyShine() {
  [bloom.strength, bloom.radius, bloom.threshold] = (terrain.on ? TERRAIN_GLARE : GLARE)[opt.glare];
  const dim = opt.glare === 'soft' ? 0.5 : 1; scene.traverse((object) => { if (object.isSprite) object.material.opacity = dim; });
}
const setShine = (glare) => { opt.glare = glare; applyShine(); syncPanel(); syncURL(); };
document.getElementById('shine').addEventListener('click', () => setShine(opt.glare === 'full' ? 'soft' : 'full'));
// Edges: the lines that link one thing to another, shown or hidden.
function setEdges(on) { opt.edges = on; dirty = true; extrasDirty = true; syncPanel(); syncURL(); }
document.getElementById('edges').addEventListener('click', () => setEdges(!opt.edges));
// Everything: every kind of record, every lens and the whole tree; pressed again, the view as the stage showed it.
const isEverything = () => KINDS.every(([key, , , count]) => !count() || opt.show.has(key)) && opt.lenses.size === lensList.length && opt.depth >= MAX_DEPTH;
function setEverything(on) {
  opt.show = new Set(on ? KINDS.map(([key]) => key) : DEFAULT_SHOW); opt.lenses = new Set(on ? lensList.map((lens) => lens.id) : []); opt.depth = on ? MAX_DEPTH : 2;
  showThoughts(opt.show.has('notes')); computeLayout(); apply(); syncPanel(); syncURL(); extrasDirty = true;
}
document.getElementById('everything').addEventListener('click', () => setEverything(!isEverything()));
for (const button of document.querySelectorAll('#cameras button')) button.addEventListener('click', () => setCamera(button.dataset.camera));
for (const button of document.querySelectorAll('#modes button')) button.addEventListener('click', () => { stop(); opt.mode = button.dataset.mode; atEnd = true; tau = C1; now = F.b; apply(); syncPanel(); syncURL(); });
for (const button of document.querySelectorAll('#speeds button')) button.addEventListener('click', () => { opt.speed = Number(button.dataset.speed); if (playing) { stop(); play(); } syncPanel(); syncURL(); });
for (const button of document.querySelectorAll('#presets button')) button.addEventListener('click', () => preset(button.dataset.preset));
for (const button of document.querySelectorAll('#layouts button')) button.addEventListener('click', () => setLayout(button.dataset.layout));
{ const depths = document.getElementById('depths'); for (let level = 0; level <= MAX_DEPTH; level += 1) { const button = document.createElement('button'); button.textContent = String(level); button.addEventListener('click', () => { opt.depth = level; computeLayout(); syncPanel(); syncURL(); }); depths.append(button); } }
{ const kinds = document.getElementById('kinds');
  for (const [key, name, swatch, count] of KINDS) {
    const n = count(); if (!n) continue; const row = document.createElement('div'); row.className = 'toggle'; row.dataset.key = key; row.style.setProperty('--swatch', swatch);
    row.innerHTML = '<span class="box"></span><span class="name"></span><span class="n"></span>'; row.querySelector('.name').textContent = name; row.querySelector('.n').textContent = n;
    row.addEventListener('click', () => { if (key === 'notes') { showThoughts(!opt.show.has('notes')); return; } if (opt.show.has(key)) opt.show.delete(key); else opt.show.add(key); computeLayout(); apply(); syncPanel(); syncURL(); }); kinds.append(row);
  } }
{ const box = document.getElementById('lenses');
  for (const lens of lensList) {
    const row = document.createElement('div'); row.className = 'toggle'; row.dataset.lens = lens.id; row.style.setProperty('--swatch', [...lens.palette.values()][0]);
    row.innerHTML = '<span class="box"></span><span class="name"></span><span class="keys"></span><span class="n"></span>';
    row.querySelector('.name').textContent = lens.name; row.querySelector('.n').textContent = lens.readings.length; row.title = `${lens.question ?? ''}${lens.why ? `\n\n${lens.why}` : ''}`;
    for (const hex of [...lens.palette.values()].slice(0, 5)) { const i = document.createElement('i'); i.style.background = hex; row.querySelector('.keys').append(i); }
    row.addEventListener('click', () => { if (opt.lenses.has(lens.id)) opt.lenses.delete(lens.id); else opt.lenses.add(lens.id); syncPanel(); syncURL(); extrasDirty = true; }); box.append(row);
    const key = document.createElement('div'); key.className = 'lens-key'; key.dataset.lens = lens.id;
    for (const [answer, hex] of [...lens.palette, ['remainder', REMAINDER]]) { const item = document.createElement('span'); const dot = document.createElement('i'); dot.style.background = hex; item.append(dot, document.createTextNode(answer.replace(/_/g, ' '))); key.append(item); }
    box.append(key);
  }
  if (!lensList.length) box.closest('section').hidden = true; }
if (!hasTree) { document.querySelector('#layouts [data-layout="layers"]').hidden = true; document.getElementById('depth-section').hidden = true; }
{ const whose = document.getElementById('whose'); for (const group of groups) { const item = document.createElement('span'); const dot = document.createElement('i'); dot.style.background = group.hue; item.append(dot, document.createTextNode(group.label)); whose.append(item); } }
document.getElementById('all').addEventListener('click', () => { const all = KINDS.every(([key]) => opt.show.has(key)); opt.show = new Set(all ? DEFAULT_SHOW : KINDS.map(([key]) => key)); showThoughts(opt.show.has('notes')); computeLayout(); apply(); syncPanel(); syncURL(); });
document.getElementById('lenses-all').addEventListener('click', () => { opt.lenses = opt.lenses.size === lensList.length ? new Set() : new Set(lensList.map((lens) => lens.id)); syncPanel(); syncURL(); extrasDirty = true; });
function syncPanel() {
  if (!ready) return;
  const on = (selector, attr, value) => { for (const button of document.querySelectorAll(selector)) button.classList.toggle('on', button.dataset[attr] === String(value)); };
  document.getElementById('play').setAttribute('aria-label', building() ? 'Play the construction' : "Play the story's years");
  document.getElementById('layout-note').textContent = { together: 'Every process on its own scale in one field, as the stage showed it.', layers: "The model's tree level by level: the world, what it holds, each life and its parts, every process at the level of what holds it.", terrain: 'Every function of the model as one terrain, as the landscape showed it: the lives and their shocks, the processes they run through, what they want, feel and expect, and the world behind them.' }[opt.layout];
  const lifeName = lives.length ? `${lives[lifeTurn % lives.length].name}'s life` : 'A life';
  setText('t-show', { together: 'Processes', layers: 'Tree', terrain: 'Terrain' }[opt.layout]); setText('t-camera', { spin: 'Spinning', free: 'Free', locked: 'Locked' }[opt.camera]);
  setText('t-time', currentPreset ? { story: 'Story', life: lifeName, centuries: 'Centuries', world: 'World history' }[currentPreset] : spanText(F.a, F.b));
  setText('t-play', `${building() ? 'The construction' : "The story's years"}${opt.speed !== 1 ? ` · ${{ 0.25: '¼', 0.5: '½' }[opt.speed] ?? opt.speed}×` : ''}`);
  setText('mode-note', building() ? 'The model and the story graph as the agent built them, step by step, with its own reasons as captions.' : 'History plays forward: the processes draw on, and events, decisions and thoughts arrive as their moments come.');
  const shine = document.getElementById('shine'); shine.setAttribute('aria-pressed', String(opt.glare === 'full')); setText('shine', opt.glare === 'full' ? 'Shining' : 'Less shining');
  document.getElementById('everything').setAttribute('aria-pressed', String(isEverything()));
  document.getElementById('edges').setAttribute('aria-pressed', String(opt.edges)); setText('edges', opt.edges ? 'Edges' : 'No edges');
  on('#cameras button', 'camera', opt.camera); on('#modes button', 'mode', opt.mode); on('#speeds button', 'speed', opt.speed); on('#layouts button', 'layout', opt.layout);
  for (const button of document.querySelectorAll('#presets button')) button.classList.toggle('on', button.dataset.preset === currentPreset);
  const life = document.querySelector('#presets [data-preset="life"]'); if (life) life.textContent = currentPreset === 'life' ? lifeName : 'A life';
  for (const [i, button] of [...document.querySelectorAll('#depths button')].entries()) button.classList.toggle('on', i === opt.depth);
  document.getElementById('depth-note').textContent = depthNote[opt.depth] ?? '';
  for (const row of document.querySelectorAll('#kinds .toggle')) row.classList.toggle('on', opt.show.has(row.dataset.key));
  for (const row of document.querySelectorAll('#lenses .toggle')) row.classList.toggle('on', opt.lenses.has(row.dataset.lens));
  for (const key of document.querySelectorAll('#lenses .lens-key')) key.hidden = !opt.lenses.has(key.dataset.lens);
  document.getElementById('span').textContent = `${timeText(F.a)} – ${timeText(F.b)} · ${spanText(F.a, F.b)}${F.w > 0.5 ? ' · years before the present, on a log scale' : ''}`;
}
addEventListener('keydown', (event) => {
  if (event.target.closest?.('input, textarea, select') || event.metaKey || event.ctrlKey) return;
  const keys = { 1: 'story', 2: 'life', 3: 'centuries', 4: 'world' }; if (keys[event.key]) preset(keys[event.key]);
  if (event.key === 'l' || event.key === 'L') setLayout('layers');
  if (event.key === 't' || event.key === 'T') setLayout('together');
  if (event.key === 'r' || event.key === 'R') setLayout('terrain');
  if (event.key === 'c' || event.key === 'C') setCamera({ spin: 'free', free: 'locked', locked: 'spin' }[opt.camera]);
  if (event.key === 'g' || event.key === 'G') setShine(opt.glare === 'full' ? 'soft' : 'full');
  if (event.key === 'x' || event.key === 'X') setEverything(!isEverything());
  if (event.key === 'k' || event.key === 'K') setEdges(!opt.edges);
  if (event.key === ' ' && !event.target.closest?.('button')) { event.preventDefault(); if (playing) stop(); else play(); }
  if (event.key === '+' || event.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.6); if (event.key === '-') zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.6);
  if (opt.camera === 'locked' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); scrollLocked(event.key === 'ArrowDown' ? 120 : -120); }
});

// The URL keeps every choice that differs from the view as it always was, so a view can be copied and captured.
let urlTimer = null;
function syncURL() {
  if (!ready) return; clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const next = new URLSearchParams(); for (const key of ['data', 'title', 'live', 'capture']) if (params.has(key)) next.set(key, params.get(key));
    if (opt.camera !== 'spin') next.set('camera', opt.camera); if (opt.glare !== 'full') next.set('glare', opt.glare); if (!opt.edges) next.set('edges', 'off');
    if (opt.mode !== 'story') next.set('mode', opt.mode); if (opt.speed !== 1) next.set('speed', String(opt.speed));
    if (currentPreset && currentPreset !== 'story') { next.set('zoom', currentPreset); if (currentPreset === 'life' && lives.length) next.set('life', lives[lifeTurn % lives.length].name.toLowerCase()); }
    else if (!currentPreset) { const digits = Math.max(0, Math.min(6, Math.ceil(-Math.log10(F.s)) + 3)); next.set('t0', F.a.toFixed(digits)); next.set('t1', F.b.toFixed(digits)); }
    if (opt.layout !== 'together') next.set('view', opt.layout); if (opt.depth !== 2) next.set('depth', String(opt.depth));
    if (opt.camera === 'free' && (camera.position.distanceTo(HOME.position) > 0.05 || controls.target.distanceTo(HOME.target) > 0.05)) next.set('pose', [...camera.position.toArray(), ...controls.target.toArray()].map((v) => v.toFixed(1)).join(','));
    const show = [...opt.show].sort().join(','); const without = DEFAULT_SHOW.filter((key) => key !== 'notes').sort().join(',');
    if (isEverything()) { next.set('everything', ''); next.delete('depth'); }
    else { if (show === without) next.set('nothoughts', ''); else if (show !== [...DEFAULT_SHOW].sort().join(',')) next.set('show', show); if (opt.lenses.size) next.set('lenses', opt.lenses.size === lensList.length ? 'all' : [...opt.lenses].join(',')); }
    if (!atEnd && !playing) next.set('at', opt.mode === 'construction' ? new Date(tau).toISOString() : now.toFixed(4)); else if (!atEnd && opt.mode === 'construction') next.set('at', new Date(tau).toISOString());
    if (!document.getElementById('reader').hidden) next.set('read', document.getElementById('reader').classList.contains('full') ? 'full' : ''); if (!qrPanel.hidden) next.set('qr', '');
    const query = next.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/\+/g, '%20').replace(/=(&|$)/g, '$1');
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }, 400);
}

// ---- keeping the view laid out, and hover -------------------------------------------------------------------------------------------
function relayOut() {
  relayout = false; dirty = false;
  for (const row of rows) layRow(row);
  for (const { group, object } of groupLabels) { const own = rows.filter((row) => row.group === group); const vis = Math.min(...own.map(presence)); const zs = own.map((row) => rowAt(row).z); object.visible = vis > 0.5 && smooth(blend.now) < 0.5; object.position.set(-LENGTH / 2 - 1.2, 0.3, Math.min(...zs) - GAP * 0.62); }
  // The axis: ticks along the front, their lines across the field.
  currentTicks = tickMarks(); const m = smooth(blend.now); const front = zFrontNow(); const back = zBackNow();
  const baseY = layersBounds && m > 0.5 ? layersBounds.y0 * m : 0; const frontZ = layersBounds ? front + (Math.max(front, layersBounds.z1) - front) * m : front;
  tickPool.forEach((slot, i) => {
    const tick = currentTicks[i]; slot.object.visible = Boolean(tick); slot.line.visible = Boolean(tick) && m < 0.99 && !terrain.on;
    if (!tick) return; const x = X(tick.t); if (slot.object.element.textContent !== tick.text) slot.object.element.textContent = tick.text;
    if (terrain.on) slot.object.position.set(x, 0, terrain.zMax + 1.5 * TS); else slot.object.position.set(x, baseY, frontZ + 2.2);
    const attr = slot.line.geometry.attributes.position; attr.array.set([x, 0.01, back - 2, x, 0.01, front + 1.4]); attr.needsUpdate = true; slot.line.material.opacity = 0.8 * (1 - m); slot.line.geometry.computeBoundingSphere();
  });
  for (const thread of threads) layThread(thread);
  for (const item of [...decisions, ...lenses]) layOnFront(item);
  placeNotes(); reframe(); if (terrain.on) layTerrain();
  // The sweep reaches across whatever the field holds.
  const z0 = Math.min(back, layersBounds && m > 0.01 ? layersBounds.z0 : back); const z1 = Math.max(front, layersBounds && m > 0.01 ? layersBounds.z1 : front);
  sweep.scale.set((z1 - z0 + 12) / (zFront - zBack + 12), 1, 1); sweep.position.z = (z0 + z1) / 2 + 2; sweep.position.y = (AMP + 6) / 2 - 0.5 + (layersBounds && m > 0.01 ? ((layersBounds.y0 + layersBounds.y1) / 2) * m : 0);
  apply(); syncPanel();
}
renderer.domElement.addEventListener('pointermove', (event) => { pointerAt = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener('pointerleave', () => { pointerAt = null; tip.hidden = true; });
// A click on anything opens what it is beside the view, as in the understanding graph; a click on nothing closes it.
const details = document.getElementById('details');
function showDetails(nodes) { document.getElementById('details-body').replaceChildren(...nodes); details.hidden = false; document.body.classList.add('details-open'); fitOpenPanels(); if (opt.camera === 'locked') { fitLocked(); placeLocked(true); } dirty = true; }
function hideDetails() { if (details.hidden) return; selectedPart = null; selectedEventIds.clear(); extrasDirty = true; details.hidden = true; document.body.classList.remove('details-open'); if (opt.camera === 'locked') { fitLocked(); placeLocked(true); } dirty = true; }
document.getElementById('details-close').addEventListener('click', hideDetails);
addEventListener('keydown', (event) => { if (event.key === 'Escape') hideDetails(); });
let downAt = null; renderer.domElement.addEventListener('pointerdown', (event) => { downAt = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener('click', (event) => {
  if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return; // a drag, not a click
  if (litUnit) { document.getElementById('reader').hidden = false; renderReader(litUnit.id); return; }
  pointerAt = { x: event.clientX, y: event.clientY }; hoveredAt = null; quietAt = null; hover();
  if (!tip.hidden && tip.childNodes.length) { showDetails([...tip.childNodes].map((node) => node.cloneNode(true))); tip.hidden = true; quietAt = { ...pointerAt }; } else hideDetails();
});
// Love-or-fear chips lift clear of each other; values and event names that would cover something wait for their turn.
function declutter() {
  // A selected document may move out of view with the graph; never show a clipped badge.
  const selectedLabel = selectedDocumentLabel.element; selectedLabel.style.visibility = '';
  if (selectedDocumentLabel.visible) {
    const r = selectedLabel.getBoundingClientRect();
    if (r.left < 2 || r.right > innerWidth - 2 || r.top < 2 || r.bottom > innerHeight - 2) selectedLabel.style.visibility = 'hidden';
  }
  const tickRects = [];
  for (const { object } of tickPool) {
    const el = object.element; el.style.visibility = '';
    if (!object.visible) continue;
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    if (tickRects.some((p) => r.left < p.right + 6 && r.right > p.left - 6 && r.top < p.bottom && r.bottom > p.top)) el.style.visibility = 'hidden';
    else tickRects.push(r);
  }
  if (terrain.on) { declutterTerrain(); return; }
  const panels = [...document.querySelectorAll('.hud.caption, .hud.bar, .hud.legend, .hud.title, .hud.stats')].map((el) => el.getBoundingClientRect());
  for (const el of document.querySelectorAll('#tools, .pop:not([hidden]), #details:not([hidden])')) panels.push(el.getBoundingClientRect());
  const placed = [...panels];
  // Beyond the stage's field (the tree added, layers, another scale, or held still) the names of whoever and whatever
  // would cover each other take turns, and a love-or-fear chip with no room waits; the stage's field keeps its own rules.
  const stage = isStory() && blend.now === 0 && opt.camera !== 'locked' && !nodes.some((node) => node.inT);
  const names = [];
  for (const object of [...groupLabels.map((item) => item.object), ...rows.map((row) => row.name)]) {
    const el = object.element; if (stage || !object.visible) { if (el.style.visibility) el.style.visibility = ''; continue; }
    el.style.visibility = ''; const r = el.getBoundingClientRect(); if (!r.width) continue;
    if (names.some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom - 4 && r.bottom > o.top + 4)) el.style.visibility = 'hidden'; else names.push(r);
  }
  for (const el of labels.domElement.querySelectorAll('.label.row, .label.group, .label.year, .label.lane')) { if (el.style.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (r.width) placed.push(r); }
  const hits = (r, lift = 0) => placed.some((p) => r.left < p.right + 4 && r.right > p.left - 4 && r.top - lift < p.bottom + 2 && r.bottom - lift > p.top - 2);
  for (const lens of lenses.filter((item) => item.visible).sort((a, b) => a.userData.t - b.userData.t)) {
    const inner = lens.element.firstElementChild; const r = lens.element.getBoundingClientRect(); if (!r.width) continue;
    let lift = 0; while (lift <= 150 && hits(r, lift)) lift += 6;
    const room = stage || lift <= 150; inner.style.visibility = room ? '' : 'hidden';
    inner.style.transform = `translateY(${-lift}px)`; if (room) placed.push({ left: r.left, right: r.right, top: r.top - lift, bottom: r.bottom - lift });
  }
  for (const row of rows) { const el = row.value.element; el.style.opacity = ''; const r = el.getBoundingClientRect(); if (!r.width) continue; if (hits(r)) el.style.opacity = '0'; else placed.push(r); }
  const tags = threads.map((thread) => thread.userData.tag).filter((tag) => tag?.visible && tag.parent?.visible !== false).sort((a, b) => b.userData.weight - a.userData.weight || b.userData.t - a.userData.t);
  for (const tag of tags) {
    const r = tag.element.getBoundingClientRect(); if (!r.width) continue;
    const free = !hits(r); tag.element.style.opacity = free ? '' : '0'; if (free) placed.push(r);
  }
}
const distToSeg = (p, a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy); };
const tipLine = (cls, text) => { const el = document.createElement('div'); el.className = cls; el.textContent = text; return el; };
function hover() {
  curtainMark.visible = false; if (overStrip) return;
  if (terrain.on) { hoverTerrain(); return; }
  if (!pointerAt) return;
  // The nearest light on screen within 16 pixels: the lights are small, so a pointer near one reads it.
  let hit = null; let best = 16 * 16; const at = new THREE.Vector3();
  for (const item of [...(mind.visible ? hoverable : []), ...eventSparks, ...decisions]) {
    if (!item.visible || item.parent?.visible === false) continue;
    item.getWorldPosition(at).project(camera); if (at.z > 1) continue;
    const dx = (at.x + 1) / 2 * innerWidth - pointerAt.x; const dy = (1 - at.y) / 2 * innerHeight - pointerAt.y; const d = dx * dx + dy * dy;
    if (d < best) { best = d; hit = item; }
  }
  // What the panel added: the nearest bar, reading or part of the prose, when no light is nearer.
  let extra = null; let bestExtra = Math.min(11, Math.sqrt(best));
  for (const target of extraTargets) {
    let d = Infinity;
    if (target.wpt) { const s = screen(...target.wpt); if (s.ok) d = Math.hypot(s.x - pointerAt.x, s.y - pointerAt.y) - (target.r ?? 11) + 11; }
    else if (target.wseg) { const a = screen(...target.wseg[0]); const b = screen(...target.wseg[1]); if (a.ok && b.ok) d = distToSeg(pointerAt, a, b) + 2; }
    if (d < bestExtra) { bestExtra = d; extra = target; }
  }
  const nextNode = extra?.node ?? null; const nextReading = extra?.reading ?? null; const nextUnit = extra?.unit ?? null;
  if (nextNode !== litNode || nextReading !== litReading || nextUnit !== litUnit) {
    litNode = nextNode; litReading = nextReading; litUnit = nextUnit; litChain = new Set();
    for (const id of [litNode?.id, litReading?.eventId, ...(litUnit?.tells ?? []).map((tell) => tell.eventId)]) if (id) for (let at2 = id, hops = 0; at2 && hops < 16; at2 = treeById.get(at2)?.parent, hops += 1) litChain.add(at2);
    extrasDirty = true;
  }
  if (extra) { lit = null; showExtraTip(extra); return; }
  // A causal link under the pointer, when no light or bar is nearer.
  let arc = null; if (!hit) { let bestArc = 8; for (const target of arcTargets) for (let i = 1; i < target.pts.length; i += 1) { const a = screen(target.pts[i - 1].x, target.pts[i - 1].y, target.pts[i - 1].z); const b = screen(target.pts[i].x, target.pts[i].y, target.pts[i].z); if (!a.ok || !b.ok) continue; const d = distToSeg(pointerAt, a, b); if (d < bestArc) { bestArc = d; arc = target; } } }
  if (arc !== litArc) { litArc = arc; drawArcs(); }
  if (arc) { if (lit) { lit = null; drawNotes(); } renderer.domElement.style.cursor = 'help'; tip.replaceChildren(...arcLines(arc).map(([cls, text]) => tipLine(cls, text))); placeTip(); return; }
  // A curtain under the pointer: its process's display value and how it was obtained.
  const curtain = hit ? null : curtainAt(pointerAt); curtainMark.visible = Boolean(curtain) && field.visible;
  if (curtain) { if (lit) { lit = null; drawNotes(); } renderer.domElement.style.cursor = 'crosshair'; tip.replaceChildren(...curtainLines(curtain).map(([cls, text]) => tipLine(cls, text))); placeTip(); return; }
  if (!hit) { tip.hidden = true; renderer.domElement.style.cursor = ''; if (lit) { lit = null; drawNotes(); } return; }
  if (lit !== hit) { lit = hit; drawNotes(); }
  const info = hit.userData.hover; renderer.domElement.style.cursor = 'help';
  tip.replaceChildren();
  const kind = document.createElement('div'); kind.className = 'k'; kind.textContent = info.kind; tip.append(kind);
  const repeats = info.title && info.text && info.text.startsWith(info.title.replace(/…$/, ''));
  if (info.title && !repeats) { const title = document.createElement('div'); title.className = 'v'; title.textContent = info.title; tip.append(title); }
  if (info.text && info.text !== info.title) { const text = document.createElement('div'); text.className = 'm'; text.textContent = info.text; tip.append(text); }
  if (info.about?.length) { const about = document.createElement('div'); about.className = 'a'; about.textContent = hit.userData.decision ? info.about.join(' · ') : `${info.kind === 'Event' ? 'Moves' : 'About'}: ${info.about.slice(0, 6).join(' · ')}`; tip.append(about); }
  if (info.values?.length) { tip.append(tipLine('a', 'At this moment')); for (const line of info.values) tip.append(tipLine('num-line', line)); }
  if (info.attached) { if (!info.attached.length) tip.append(tipLine('a', 'Attached to nothing in the model: a note of the agent’s own.')); else { tip.append(tipLine('a', 'Attached to')); for (const line of info.attached) tip.append(tipLine('a', line)); } }
  placeTip();
}
let quietAt = null; // where a click opened the details: no tooltip there until the pointer moves
// The curtain under a point on screen, the time there and the displayed value of its process, marked on its crest.
const wallRay = new THREE.Raycaster(); const wallNdc = new THREE.Vector2(); const curtainMark = spark('#ffffff', 1.3); curtainMark.visible = false; field.add(curtainMark);
// The bright top line nearest the pointer names the curtain (they stand one behind another); else the curtain in front of it.
function curtainAt(point) {
  let best = null; let bestD = 14; const STEP = 5;
  for (const row of rows) {
    if (!row.wall.visible || presence(row) <= 0.5) continue; const array = row.crest.geometry.attributes.position.array; const upto = Math.min(NX, row.crest.geometry.drawRange.count); let prev = null;
    for (let i = 0; i < upto; i += i + STEP >= upto && i !== upto - 1 ? upto - 1 - i : STEP) {
      const at = screen(array[i * 3], array[i * 3 + 1], array[i * 3 + 2]);
      if (prev && at.ok && prev.at.ok) { const dx = at.x - prev.at.x; const dy = at.y - prev.at.y; const k = Math.max(0, Math.min(1, ((point.x - prev.at.x) * dx + (point.y - prev.at.y) * dy) / (dx * dx + dy * dy || 1))); const d = Math.hypot(point.x - prev.at.x - k * dx, point.y - prev.at.y - k * dy);
        if (d < bestD) { bestD = d; best = { row, t: row.sampleT[prev.i] + k * (row.sampleT[i] - row.sampleT[prev.i]) }; } }
      prev = { at, i }; if (i === upto - 1) break;
    }
  }
  if (!best) {
    wallNdc.set((point.x / innerWidth) * 2 - 1, -(point.y / innerHeight) * 2 + 1); wallRay.setFromCamera(wallNdc, camera);
    const hit = wallRay.intersectObjects(rows.filter((row) => row.wall.visible && presence(row) > 0.5).map((row) => row.wall), false)[0]; if (!hit) return null;
    const row = rows.find((item) => item.wall === hit.object); best = { row, t: timeAtX(hit.point.x) };
  }
  const { row } = best; const t = Math.max(row.domain[0], Math.min(row.domain[1], best.t)); const p = rowAt(row);
  curtainMark.position.set(X(t), p.y + heightAt(row, t) + 0.05, p.z); return { row, t };
}
function curtainLines({ row, t }) {
  return [['k', `${row.group.label} · a named process`], ['v', NAMES[row.measure.id] ?? row.measure.id], ['m', momentText(t)], ...measureValueLines(row, t),
    ['a', `Unit: ${row.measure.unit ?? 'not given'} · on its own scale, ${format(row, row.range[0])} to ${format(row, row.range[1])}`]];
}
function placeTip() { if (quietAt && pointerAt && quietAt.x === pointerAt.x && quietAt.y === pointerAt.y) { tip.hidden = true; return; } quietAt = null; tip.hidden = false; const w = tip.offsetWidth; const h = tip.offsetHeight; tip.style.left = `${Math.min(innerWidth - w - 12, pointerAt.x + 16)}px`; tip.style.top = `${Math.min(innerHeight - h - 12, Math.max(12, pointerAt.y + 16))}px`; }
const weightsBox = (answers, colorOf) => { const box = document.createElement('div'); box.className = 'w'; for (const answer of answers.slice(0, 6)) { const b = document.createElement('b'); b.textContent = `${Math.round(answer.weight * 100)}%`; if (colorOf) b.style.color = colorOf(answer.key); const i = document.createElement('i'); i.textContent = answer.key.replace(/[_.-]+/g, ' '); box.append(b, i); } return box; };
function showExtraTip(target) {
  renderer.domElement.style.cursor = target.kind === 'prose' ? 'pointer' : 'help'; tip.replaceChildren();
  if (target.kind === 'event' || target.kind === 'sub') {
    const { event } = target.node; const holder = event.parent ? treeById.get(event.parent) : null; const who = principals.find((person) => person.id === event.owner)?.name ?? referents.get(event.owner)?.name ?? 'The world';
    const roles = { world: 'The world', development: 'A long development', life: 'A life', inner: 'An inner life', period: 'A period of a life', arc: 'A change arc', phase: 'A phase of a change arc', slow: 'A slow process of a life', part: 'A part', moment: 'A moment' };
    const own = event.context === 'inner';
    tip.append(tipLine('k', own ? `${who}'s own · ${event.role === 'inner' ? 'their inner process' : 'a record of their inner process'} · level ${event.depth}` : `${roles[event.role] ?? 'An Event'} · level ${event.depth} · ${who}`), tipLine('v', clip(event.label, 200)));
    if (own) tip.append(tipLine('a', `Held in ${who.split(' ')[0]}'s inner process: their own view, not a fact of the world. Where it differs from the world, it is how they see it.`));
    tip.append(tipLine('m', `${timeText(event.reach[0], Math.min(40, event.reach[1] - event.reach[0]))} – ${timeText(event.reach[1], Math.min(40, event.reach[1] - event.reach[0]))}`));
    if (event.description) tip.append(tipLine('m', clip(event.description, 360)));
    const moves = (event.processIds ?? []).map((id) => processById.get(id)).filter((process) => process?.kind === 'named').map((process) => NAMES[process.id]);
    if (moves.length) tip.append(tipLine('a', `Moves: ${moves.join(' · ')}`));
    if (holder) tip.append(tipLine('a', `Within: ${clip(holder.name, 80)}`));
  } else if (target.kind === 'lens') {
    const { lens, reading } = target; const event = byId.get(reading.eventId);
    tip.append(tipLine('k', `A reading · ${lens.name}${reading.earlier ? ' · asked of an earlier version' : ''}`), tipLine('v', `${holderText(reading, data.people).replace(/^\w/, (c) => c.toUpperCase())}, of: ${clip(event?.label ?? reading.eventId, 110)}`), tipLine('m', reading.question ?? lens.question ?? ''));
    if (reading.unit) { const signed = reading.unit.match(/^lens:([^@]+)@(\w+)$/); tip.append(tipLine('a', `Unit: ${signed ? `a share of this lens's reading, answering its version ${signed[2].slice(0, 8)}` : reading.unit}`)); }
    const split = document.createElement('div'); split.className = 'split';
    for (const answer of reading.answers.filter((item) => item.weight > 0).sort((a, b) => (a.key === 'remainder') - (b.key === 'remainder'))) { const i = document.createElement('i'); i.style.width = `${answer.weight * 100}%`; i.style.background = lens.colorOf(answer.key); split.append(i); }
    tip.append(split, weightsBox(reading.answers, (key) => lens.colorOf(key)));
    tip.append(tipLine('a', `At the record's time, ${timeText(reading.t, 1)}${reading.confidence ? ` · confidence ${reading.confidence.toFixed(2)}` : ''}${reading.estimated ? ' · estimated' : ' · authored'} · evidence cutoff not recorded`));
  } else if (target.kind === 'prose') {
    const { unit } = target; tip.append(tipLine('k', `Prose · ${timeText(unit.t, 2)}`), tipLine('v', unit.title ?? ''), tipLine('m', clip(unit.text.replace(/^#+\s+.*$/m, '').trim(), 420)));
    tip.append(tipLine('a', `Depicts: ${(unit.tells ?? []).map((tell) => clip(byId.get(tell.eventId)?.label, 44)).join(' · ')}`), tipLine('a', 'Placed by its declared Event links. Click to read it.'));
  }
  placeTip();
}

// ---- the start ---------------------------------------------------------------------------------------------------------------------------
ready = true; tabulate(); computeLayout();
if (params.has('t0') && params.has('t1')) { currentPreset = null; setView(Math.max(BOUNDS[0], Number(params.get('t0'))), Math.min(BOUNDS[1], Number(params.get('t1')))); }
else if (params.has('focus') && treeById.has(params.get('focus'))) { const { reach } = treeById.get(params.get('focus')); currentPreset = null; setView(...windowAt((reach[0] + reach[1]) / 2, 0.5, Math.max(0.02, (reach[1] - reach[0]) * 1.6))); }
else if (currentPreset && currentPreset !== 'story') preset(currentPreset, false);
if (params.has('at')) { const at = params.get('at'); if (opt.mode === 'construction') { const t = Date.parse(at); if (Number.isFinite(t)) { tau = Math.max(C0, Math.min(C1, t)); atEnd = tau >= C1; } } else if (Number.isFinite(Number(at))) { now = Number(at); atEnd = false; } }
if (opt.layout === 'terrain') { showTerrain(true); if (opt.camera !== 'locked') { camera.position.copy(terrain.home.position); controls.target.copy(terrain.home.target); } }
setCamera(opt.camera, true); if (opt.glare !== 'full') applyShine();
// A kept pose was the camera's in the field as the URL has it.
if (params.has('pose')) { const v = params.get('pose').split(',').map(Number); if (v.length === 6 && v.every(Number.isFinite)) { camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3], v[4], v[5]); framed = fieldFrame(); } }
relayOut();
// Following a run an agent is still making: when it has made more, the view opens again as it is, between plays.
if (params.has('live')) setInterval(async () => {
  if (playing) return;
  try { const next = await (await fetch(`data/${encodeURIComponent(dataName)}.json?ts=${Date.now()}`, { cache: 'no-store' })).json(); if (next.lastCall !== data.lastCall || next.headGraphHash !== data.headGraphHash) { syncURL(); setTimeout(() => location.reload(), 500); } } catch { /* keep the last view */ }
}, 20000);
let last = performance.now();
// Walking through the view: W and S forward and back, A and D to the sides, Q and E down and up, the arrows to look around,
// Shift to go faster. The first step stops the spin. Locked, A and D move through time and W and S zoom in and out of it.
const held = new Set(); const WALK = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
addEventListener('keydown', (event) => {
  if (event.target.closest?.('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return; const key = event.key.toLowerCase(); if (!WALK.has(key)) return;
  if (opt.camera === 'locked' && key.startsWith('arrow')) return; // the arrows scroll a tall locked view
  if (!held.size && opt.camera === 'spin') setCamera('free'); held.add(key); event.preventDefault();
});
addEventListener('keyup', (event) => { held.delete(event.key.toLowerCase()); if (!held.size && opt.camera === 'free') syncURL(); });
addEventListener('blur', () => held.clear());
const forward = new THREE.Vector3(); const side = new THREE.Vector3(); const UP = new THREE.Vector3(0, 1, 0);
function walk(dt) {
  if (!held.size) return; const fast = shiftDown ? 3 : 1; const k = (key) => (held.has(key) ? 1 : 0);
  if (opt.camera === 'locked') { const step = dt * fast; if (k('a') || k('d')) { const [a, b] = windowAt(timeAt(F, 0.5), 0.5 + (k('d') - k('a')) * step * 0.6, F.s); animation = null; clearPreset(); setView(a, b); } if (k('w') || k('s')) zoomAt(innerWidth / 2, innerHeight / 2, Math.exp((k('w') - k('s')) * step * 1.4)); return; }
  const distance = camera.position.distanceTo(controls.target); const speed = Math.max(4, distance * 0.45) * dt * fast;
  camera.getWorldDirection(forward); forward.y = 0; if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); forward.normalize(); side.crossVectors(forward, UP).normalize();
  const move = new THREE.Vector3().addScaledVector(forward, (k('w') - k('s')) * speed).addScaledVector(side, (k('d') - k('a')) * speed).addScaledVector(UP, (k('e') - k('q')) * speed);
  camera.position.add(move); controls.target.add(move);
  // Looking around turns the view about the camera itself.
  const yaw = (k('arrowleft') - k('arrowright')) * dt * 1.2 * fast; const pitch = (k('arrowup') - k('arrowdown')) * dt * 0.8 * fast;
  if (yaw || pitch) { const look = controls.target.clone().sub(camera.position); look.applyAxisAngle(UP, yaw); const across = new THREE.Vector3().crossVectors(look, UP).normalize(); const turned = look.clone().applyAxisAngle(across, pitch); if (Math.abs(turned.clone().normalize().y) < 0.97) look.copy(turned); controls.target.copy(camera.position).add(look); }
}
let shiftDown = false; addEventListener('keydown', (event) => { if (event.key === 'Shift') shiftDown = true; }); addEventListener('keyup', (event) => { if (event.key === 'Shift') shiftDown = false; });
function tick(clock, dt) {
  walk(dt);
  if (animation) animation(clock);
  if (Math.abs(blend.now - blend.to) > 0.001) { blend.now += Math.sign(blend.to - blend.now) * Math.min(Math.abs(blend.to - blend.now), dt / 0.9); relayout = true; if (opt.camera === 'locked') { fitLocked(); placeLocked(true); } } else if (blend.now !== blend.to) { blend.now = blend.to; relayout = true; }
  // Curtains rise as the construction makes them, and sink when the play goes back before them.
  for (const row of rows) if (row.rise !== row.riseTo) { const rise = Math.max(0, Math.min(1, row.rise)); row.rise = row.riseTo > rise ? Math.min(row.riseTo, rise + dt / 0.8) : Math.max(row.riseTo, rise - dt / 0.4); relayout = true; }
  if (relayout) relayOut(); else if (dirty) { dirty = false; apply(); }
  if (extrasDirty) { extrasDirty = false; if (!terrain.on) drawExtras(); }
  if (terrain.on) {
    let moving = false; for (const row of terrain.rows) if (row.scale !== row.target) { row.scale = Math.abs(row.target - row.scale) < 0.002 ? row.target : row.scale + (row.target - row.scale) * Math.min(1, dt * 7); moving = true; }
    if (moving) heightsTerrain();
    terrain.mind.forEach((point, i) => { if (point.visible) point.position.y = point.userData.y + Math.sin(clock / 1250 + i) * 0.2 * TS; });
  }
}
// Each frame reads the clock itself: a frame's own time stamp can come from before the last one, and time never runs
// backwards here.
let framesDrawn = 0;
function frame() {
  const clock = performance.now(); const dt = Math.max(0, Math.min(0.1, (clock - last) / 1000)); last = clock; tick(clock, dt);
  if (opt.camera === 'locked') placeLocked(); else controls.update();
  composer.render(); labels.render(scene, camera); declutter(); labels2.update(); hover();
  // Once the names are on the page their widths are known, and a locked view frames them.
  framesDrawn += 1; if (framesDrawn === 2 && opt.camera === 'locked') { fitLocked(); placeLocked(true); }
  requestAnimationFrame(() => frame());
}
// For captures and tests: the window on screen, and the view's state.
window.explorer = {
  view: () => ({ a: F.a, b: F.b, warp: F.w, camera: opt.camera, glare: opt.glare, mode: opt.mode, layout: opt.layout, depth: opt.depth, now, tau, position: camera.position.toArray().map((v) => +v.toFixed(1)) }),
  walk: (keys, seconds) => { for (const key of keys) held.add(key); if (opt.camera === 'spin') setCamera('free'); for (let t = 0; t < seconds; t += 1 / 60) walk(1 / 60); held.clear(); controls.update(); return camera.position.toArray().map((v) => +v.toFixed(1)); }, zoom: (x, y, factor) => zoomAt(x, y, factor), preset: (name) => preset(name, false),
  // Where each visible document stands on screen, to point at it in a test.
  documents: () => notes.filter((light) => light.visible).map((light) => { const point = screen(light.position.x, light.position.y, light.position.z); return { id: light.userData.id, attached: light.userData.attached.length, x: Math.round(point.x), y: Math.round(point.y) }; }),
  // Where each causal link crosses the screen, at its middle, to point at it in a test.
  arcs: (at = 0.5) => arcTargets.map((target) => { const p = target.pts[Math.floor((target.pts.length - 1) * at)]; const point = screen(p.x, p.y, p.z); return { kind: target.relation.kind, x: Math.round(point.x), y: Math.round(point.y) }; }),
  // The time a frame takes: laid out again each frame (as while zooming or turning to layers) or steady.
  parts: (n = 20) => { const parts = { tick: () => tick(performance.now(), 1 / 60), camera: () => (opt.camera === 'locked' ? placeLocked() : controls.update()), render: () => composer.render(), labels: () => labels.render(scene, camera), declutter, labels2: () => labels2.update(), hover };
    return Object.fromEntries(Object.entries(parts).map(([name, fn]) => { const times = []; for (let i = 0; i < n; i += 1) { const t0 = performance.now(); fn(); times.push(performance.now() - t0); } times.sort((a, b) => a - b); return [name, +times[n >> 1].toFixed(2)]; })); },
  profile: (n = 30, full = true) => { const times = []; for (let i = 0; i < n; i += 1) { const t0 = performance.now(); if (full) relayout = true; tick(performance.now(), 1 / 60); if (opt.camera === 'locked') placeLocked(); else controls.update(); composer.render(); labels.render(scene, camera); declutter(); labels2.update(); hover(); times.push(performance.now() - t0); } times.sort((a, b) => a - b); return { median: +times[n >> 1].toFixed(1), max: +times.at(-1).toFixed(1) }; },
};
// Capture: a recorder sets the moment and draws one frame at a time, so a video plays at an even speed.
if (params.has('capture')) {
  document.body.classList.add('capture');
  window.__frame = (t, dt, sweeping = true) => { if (opt.mode === 'construction') tau = t; else now = t; atEnd = false; playing = sweeping; tick(performance.now(), dt ?? 0.016); apply(); if (opt.camera === 'locked') placeLocked(); else controls.update(dt); composer.render(); labels.render(scene, camera); declutter(); labels2.update(); return opt.mode === 'construction' ? [C0, C1] : [F.a, F.b]; };
  window.__span = opt.mode === 'construction' ? [C0, C1] : [F.a, F.b];
} else { frame(); if (params.has('play')) setTimeout(play, 1000); }
