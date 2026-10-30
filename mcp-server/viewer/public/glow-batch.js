// Many small glowing things drawn as a few objects. The time views place thousands of lights (Sprites with one glow
// texture, added to what is behind them) and short lines (an Event's stems and links, the time ticks), and WebGL drew
// each as a call of its own: about 6,000 a frame for a model of 239 curves. Each light and line stays in the scene,
// where everything that places, shows, hides, colours and hovers it keeps working on it; it is only kept out of the
// camera's layer, and every drawn frame copies the shown ones into instanced billboards and line segments. The billboard
// is three.js's own sprite: the same position, world size, colour, opacity, texture, fog and blending.
//
// Drawn one by one, three.js sorted each see-through object by the depth of its bounding sphere's centre and drew them
// back to front. Adding light commutes, so the order among added things does not matter; but a see-through object
// that covers what is behind it (normal blending: the curtains of light) dims what was drawn before it. So the batched
// things are split by where their own depth falls among those covering objects, and each run between two of them is
// drawn as one object sorted into that place: the picture is the one drawn one by one.
const HIDDEN_LAYER = 31;

// Whether an object and all it hangs from are shown.
const shown = (object) => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
// three.js sorts see-through objects by the render order of the nearest Group holding them, then their own, then depth.
const groupOrderOf = (object) => { for (let o = object.parent; o; o = o.parent) if (o.isGroup) return o.renderOrder; return 0; };
const sortedWithLights = (object) => object.renderOrder === 0 && groupOrderOf(object) === 0;

const BILLBOARD_VERTEX = /* glsl */ `
attribute vec3 iPosition; attribute vec2 iScale; attribute vec4 iColor;
varying vec2 vUv; varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vColor = iColor;
  vec4 mvPosition = viewMatrix * vec4(iPosition, 1.0);
  mvPosition.xy += position.xy * iScale;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BILLBOARD_FRAGMENT = /* glsl */ `
uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vColor * texture2D(map, vUv);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// One run of billboards, drawn by one call.
function billboards(THREE, map) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
    vertexShader: BILLBOARD_VERTEX, fragmentShader: BILLBOARD_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  material.uniforms.map.value = map;
  const object = new THREE.Mesh(geometry, material); object.frustumCulled = false; object.matrixAutoUpdate = false;
  let capacity = 0, n = 0, positions, scales, colors;
  const grow = (count) => {
    capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count)));
    positions = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    scales = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iPosition', positions); geometry.setAttribute('iScale', scales); geometry.setAttribute('iColor', colors);
  };
  return {
    object,
    fill(sprites) {
      if (sprites.length > capacity) grow(sprites.length);
      n = 0;
      const p = positions.array, s = scales.array, c = colors.array;
      for (const sprite of sprites) {
        const e = sprite.matrixWorld.elements, m = sprite.material;
        p[n * 3] = e[12]; p[n * 3 + 1] = e[13]; p[n * 3 + 2] = e[14];
        s[n * 2] = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]); s[n * 2 + 1] = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
        c[n * 4] = m.color.r; c[n * 4 + 1] = m.color.g; c[n * 4 + 2] = m.color.b; c[n * 4 + 3] = m.opacity;
        n += 1;
      }
      geometry.instanceCount = n;
      if (n) for (const attribute of [positions, scales, colors]) { attribute.clearUpdateRanges(); attribute.addUpdateRange(0, n * attribute.itemSize); attribute.needsUpdate = true; }
      object.visible = n > 0;
    },
  };
}

// One run of line segments, drawn by one call: each line in world space, with its colour and opacity, and its own vertex
// colours where it has them.
function segments(THREE) {
  const geometry = new THREE.BufferGeometry();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const object = new THREE.LineSegments(geometry, material); object.frustumCulled = false; object.matrixAutoUpdate = false;
  let capacity = 0, n = 0, positions, colors;
  const grow = (count) => {
    capacity = Math.max(256, 2 ** Math.ceil(Math.log2(count)));
    positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    colors = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions); geometry.setAttribute('color', colors);
  };
  const v = new THREE.Vector3();
  const span = (line) => { const range = line.geometry.drawRange, count = line.geometry.attributes.position.count; return [range.start, Math.min(count, range.start + (Number.isFinite(range.count) ? range.count : count)) - 1]; };
  return {
    object,
    fill(lines) {
      let needed = 0; for (const line of lines) { const [first, last] = span(line); needed += 2 * Math.max(0, last - first); }
      if (needed > capacity) grow(needed);
      n = 0;
      const p = positions.array, c = colors.array;
      for (const line of lines) {
        const source = line.geometry.attributes.position, tint = line.geometry.attributes.color, m = line.material, [first, last] = span(line);
        const r = m.color.r, g = m.color.g, b = m.color.b, a = m.opacity, own = m.vertexColors && tint;
        for (let i = first; i < last; i += 1) for (let k = i; k <= i + 1; k += 1) {
          v.fromBufferAttribute(source, k).applyMatrix4(line.matrixWorld); p[n * 3] = v.x; p[n * 3 + 1] = v.y; p[n * 3 + 2] = v.z;
          if (own) { c[n * 4] = r * tint.getX(k); c[n * 4 + 1] = g * tint.getY(k); c[n * 4 + 2] = b * tint.getZ(k); c[n * 4 + 3] = a * (tint.itemSize === 4 ? tint.getW(k) : 1); }
          else { c[n * 4] = r; c[n * 4 + 1] = g; c[n * 4 + 2] = b; c[n * 4 + 3] = a; }
          n += 1;
        }
      }
      geometry.setDrawRange(0, n);
      if (n) for (const attribute of [positions, colors]) { attribute.clearUpdateRanges(); attribute.addUpdateRange(0, n * attribute.itemSize); attribute.needsUpdate = true; }
      object.visible = n > 0;
    },
  };
}

// The lights and lines of a scene, drawn in runs. `add` takes a Sprite or a Line out of the camera's layer and into a
// run; `sync(scene, camera)` copies them, every drawn frame, once the world matrices are current.
export function createGlowBatches(THREE, { map }) {
  const group = new THREE.Group(); group.matrixAutoUpdate = false;
  const kinds = { sprite: { items: new Set(), runs: [], make: () => billboards(THREE, map) }, line: { items: new Set(), runs: [], make: () => segments(THREE) } };
  const center = new THREE.Vector3(), forward = new THREE.Vector3(), cameraAt = new THREE.Vector3();
  // The depth, from the camera, at which three.js sorts an object: its bounding sphere's centre, the object's own where
  // it has one (an instanced mesh), else its geometry's, along the camera's line of sight.
  const depthOf = (object) => {
    if (object.boundingSphere !== undefined) { if (object.boundingSphere === null) object.computeBoundingSphere(); center.copy(object.boundingSphere.center); }
    else { if (object.geometry.boundingSphere === null) object.geometry.computeBoundingSphere(); center.copy(object.geometry.boundingSphere.center); }
    return center.applyMatrix4(object.matrixWorld).sub(cameraAt).dot(forward);
  };
  const runOf = (kind, index) => { const runs = kinds[kind].runs; while (runs.length <= index) { const run = kinds[kind].make(); runs.push(run); group.add(run.object); } return runs[index]; };
  return {
    object: group,
    // An object drawn in another order than its neighbours is left to be drawn on its own.
    add(object) { if (object.renderOrder !== 0) return object; object.layers.set(HIDDEN_LAYER); kinds[object.isSprite ? 'sprite' : 'line'].items.add(object); return object; },
    sync(scene, camera) {
      // The covering objects the camera draws among the lights (the same orders, so sorted by depth with them), farthest
      // first; those of another order are drawn before or after all of them either way.
      camera.updateMatrixWorld(); camera.getWorldPosition(cameraAt); camera.getWorldDirection(forward);
      const covers = [];
      scene.traverseVisible((object) => {
        const material = object.material;
        if (!material || Array.isArray(material) || !material.transparent || material.blending !== THREE.NormalBlending || !material.visible || !object.layers.test(camera.layers) || !sortedWithLights(object)) return;
        if (object.isMesh || object.isLine || object.isPoints || object.isSprite) covers.push(depthOf(object));
      });
      covers.sort((a, b) => b - a);
      // Each run is placed for sorting at a depth between the covering objects around it, on the camera's line of sight.
      const placeAt = (index) => (covers.length === 0 ? 1 : index === 0 ? covers[0] * 2 + 1 : index === covers.length ? covers.at(-1) / 2 : (covers[index - 1] + covers[index]) / 2);
      for (const [kind, { items }] of Object.entries(kinds)) {
        const buckets = new Map();
        for (const item of items) {
          if (!shown(item)) continue;
          // How many covering objects lie behind it: those are drawn before it.
          const depth = depthOf(item); let lo = 0, hi = covers.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (covers[mid] > depth) lo = mid + 1; else hi = mid; }
          if (!buckets.has(lo)) buckets.set(lo, []); buckets.get(lo).push(item);
        }
        const used = new Set();
        for (const [index, list] of buckets) {
          const run = runOf(kind, used.size); used.add(run); run.fill(list);
          run.object.geometry.boundingSphere.center.copy(cameraAt).addScaledVector(forward, placeAt(index));
        }
        for (const run of kinds[kind].runs) if (!used.has(run)) run.object.visible = false;
      }
    },
  };
}
