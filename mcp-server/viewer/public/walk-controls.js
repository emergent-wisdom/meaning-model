// Walking a 3D view with the keyboard, as the time views do: W A S D move along the ground, Q and E move down and up,
// the arrows look around, and Shift is faster. The orbit target moves with the camera, so dragging still turns about
// what lies ahead. Keys typed into a field, or with a modifier, are left alone.
import * as THREE from 'three';

const WALK = new Set(['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
const UP = new THREE.Vector3(0, 1, 0);

export function createWalker({ camera, controls, isActive = () => true, onStart = () => {}, signal } = {}) {
  const held = new Set(), forward = new THREE.Vector3(), side = new THREE.Vector3();
  let fast = false;
  const typing = (event) => event.target?.closest?.('input, textarea, select, [contenteditable], [role="slider"]');
  addEventListener('keydown', (event) => {
    if (event.key === 'Shift') fast = true;
    const key = String(event.key).toLowerCase();
    if (!isActive() || !WALK.has(key) || event.metaKey || event.ctrlKey || event.altKey || typing(event)) return;
    if (!held.size) onStart();
    held.add(key); event.preventDefault();
  }, { signal });
  addEventListener('keyup', (event) => { if (event.key === 'Shift') fast = false; held.delete(String(event.key).toLowerCase()); }, { signal });
  // A key released while the window is elsewhere must not keep walking.
  addEventListener('blur', () => { held.clear(); fast = false; }, { signal });
  return {
    get walking() { return held.size > 0; },
    stop() { held.clear(); },
    // Move for dt seconds; true when the camera moved.
    step(dt) {
      if (!held.size || !isActive() || !(dt > 0)) return false;
      const k = (key) => (held.has(key) ? 1 : 0), boost = fast ? 3 : 1;
      const speed = Math.max(4, camera.position.distanceTo(controls.target) * 0.45) * dt * boost;
      camera.getWorldDirection(forward); forward.y = 0; if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); forward.normalize(); side.crossVectors(forward, UP).normalize();
      const move = new THREE.Vector3().addScaledVector(forward, (k('w') - k('s')) * speed).addScaledVector(side, (k('d') - k('a')) * speed).addScaledVector(UP, (k('e') - k('q')) * speed);
      camera.position.add(move); controls.target.add(move);
      // Looking around turns the view about the camera itself.
      const yaw = (k('arrowleft') - k('arrowright')) * dt * 1.2 * boost, pitch = (k('arrowup') - k('arrowdown')) * dt * 0.8 * boost;
      if (yaw || pitch) {
        const look = controls.target.clone().sub(camera.position); look.applyAxisAngle(UP, yaw);
        const across = new THREE.Vector3().crossVectors(look, UP).normalize(), turned = look.clone().applyAxisAngle(across, pitch);
        if (Math.abs(turned.clone().normalize().y) < 0.97) look.copy(turned);
        controls.target.copy(camera.position).add(look);
      }
      return true;
    },
  };
}
