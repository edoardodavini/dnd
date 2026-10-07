import { CONFIG } from './config.js';

// Rune i (0-based) sits at (i + 1) o'clock; angle is CCW from +X.
export function runeAngle(i) {
  return Math.PI / 2 - ((i + 1) * Math.PI) / 6;
}

export function runeCenter(i, radius) {
  const a = runeAngle(i);
  return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}

// Distance at which the ring fills `ringScreenFraction` of the height, or of the width on narrow screens.
export function fitCameraDistance(aspect, cfg = CONFIG) {
  const span = (2 * cfg.ring.outer) / cfg.camera.ringScreenFraction;
  const tanHalf = Math.tan((cfg.camera.fov * Math.PI) / 360);
  return Math.max(span / (2 * tanHalf), span / (2 * tanHalf * aspect));
}
