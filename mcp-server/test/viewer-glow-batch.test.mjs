import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../viewer/public/vendor/three/three.module.js';
import { createGlowBatches } from '../viewer/public/glow-batch.js';

const glow = new THREE.Texture();
const additive = (hex, opacity) => new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
const sprite = (hex, size, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(size); return s; };
const wall = (z, renderOrder = 0) => {
  const geometry = new THREE.PlaneGeometry(4, 2); geometry.translate(0, 1, z);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false })); mesh.renderOrder = renderOrder; return mesh;
};
function scene() {
  const root = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 900);
  camera.position.set(30, 20, 60); camera.lookAt(0, 0, 0); root.add(camera);
  return { root, camera };
}

test('lights and lines leave the camera\'s layer, and only the shown ones are copied, with their colour, opacity and size', () => {
  const { root, camera } = scene(), batches = createGlowBatches(THREE, { map: glow }); root.add(batches.object);
  const group = new THREE.Group(); group.position.x = 5; root.add(group);
  const a = batches.add(sprite('#ff0000', 2, 0.5)); a.position.set(1, 2, 3); group.add(a);
  const hiddenItself = batches.add(sprite('#00ff00', 1)); hiddenItself.visible = false; group.add(hiddenItself);
  const hiddenGroup = new THREE.Group(); hiddenGroup.visible = false; root.add(hiddenGroup);
  hiddenGroup.add(batches.add(sprite('#0000ff', 1)));
  const strip = batches.add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 9, 9, 9], 3)), additive('#ffffff', 0.35)));
  strip.geometry.setDrawRange(0, 3); group.add(strip);
  assert.equal(a.layers.test(camera.layers), false, 'the camera no longer draws the light itself');
  root.updateMatrixWorld(); batches.sync(root, camera);
  const runs = batches.object.children.filter((run) => run.visible);
  const lights = runs.find((run) => run.isMesh), lines = runs.find((run) => run.isLineSegments);
  assert.equal(lights.geometry.instanceCount, 1, 'hidden lights, and lights in a hidden group, are not drawn');
  assert.deepEqual([...lights.geometry.attributes.iPosition.array.slice(0, 3)], [6, 2, 3]);
  assert.deepEqual([...lights.geometry.attributes.iScale.array.slice(0, 2)], [2, 2]);
  const red = new THREE.Color('#ff0000');
  assert.deepEqual([...lights.geometry.attributes.iColor.array.slice(0, 4)].map((v) => +v.toFixed(5)), [red.r, red.g, red.b, 0.5]);
  assert.equal(lines.geometry.drawRange.count, 4, 'a strip of three points within its draw range is two segments');
  assert.deepEqual([...lines.geometry.attributes.position.array.slice(0, 12)], [5, 0, 0, 6, 0, 0, 6, 0, 0, 6, 1, 0]);
  assert.equal(+lines.geometry.attributes.color.array[3].toFixed(5), 0.35);
});

test('each light is drawn after exactly the covering walls three.js would have drawn before it, whatever their order', () => {
  const { root, camera } = scene(), batches = createGlowBatches(THREE, { map: glow }); root.add(batches.object);
  const walls = [-30, -20, -10, 0, 10, 20].map((z) => wall(z)); root.add(...walls);
  const late = wall(-25, 5); root.add(late); // drawn after everything of order 0, whatever its depth
  const lights = [-35, -24, -15, -5, 5, 15, 25].map((z, i) => { const s = batches.add(sprite('#ffffff', 1)); s.position.set(i - 3, 2, z); root.add(s); return s; });
  root.updateMatrixWorld(); camera.updateMatrixWorld(); batches.sync(root, camera);
  // three.js's own order, drawn one by one: group order, render order, then depth (clip z, farthest first), then id.
  const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const key = (object, center) => new THREE.Vector4(center.x, center.y, center.z, 1).applyMatrix4(object.matrixWorld).applyMatrix4(projection).z;
  const sortKey = (object) => key(object, object.isSprite ? new THREE.Vector3() : (object.geometry.computeBoundingSphere(), object.geometry.boundingSphere.center));
  const items = [...walls, late, ...lights].map((object) => ({ object, z: sortKey(object) }))
    .sort((a, b) => a.object.renderOrder - b.object.renderOrder || b.z - a.z || a.object.id - b.object.id);
  const coversBefore = (light) => items.slice(0, items.findIndex((item) => item.object === light)).filter((item) => !item.object.isSprite).length;
  const runs = batches.object.children.filter((run) => run.visible && run.isMesh)
    .map((run) => ({ run, z: new THREE.Vector4(...run.geometry.boundingSphere.center.toArray(), 1).applyMatrix4(projection).z }));
  const runBefore = (run) => [...walls, late].map((object) => ({ object, z: sortKey(object) })).filter((item) => item.object.renderOrder === 0 && item.z > run.z).length;
  const positions = (run) => Array.from({ length: run.geometry.instanceCount }, (_, i) => run.geometry.attributes.iPosition.array[i * 3 + 2]);
  for (const light of lights) {
    const { run, z } = runs.find(({ run: candidate }) => positions(candidate).includes(light.position.z));
    assert.equal(runBefore({ z }), coversBefore(light), `the light at z = ${light.position.z} keeps its place among the walls`);
    assert.ok(run.renderOrder === 0);
  }
  assert.ok(runs.length <= walls.length + 1);
});
