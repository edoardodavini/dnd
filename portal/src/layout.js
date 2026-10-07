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

// Device ratio up to the cap, then shrunk further if the canvas would exceed the pixel budget:
// a 3840×2160 buffer falls off a performance cliff, and upscaling is invisible at couch distance.
export function renderPixelRatio(cssWidth, cssHeight, devicePixelRatio, cfg = CONFIG) {
  const ratio = Math.min(devicePixelRatio, cfg.quality.maxPixelRatio);
  const budget = Math.sqrt(cfg.quality.maxPixels / (cssWidth * cssHeight));
  return Math.min(ratio, budget);
}
