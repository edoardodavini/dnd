import { CONFIG } from './config.js';

const TAU = Math.PI * 2;

// Slow orbit around the ring so the stone shows parallax; high-frequency shake only during opening.
export function cameraPose(t, shake, cfg = CONFIG.camera) {
  const amp = (cfg.driftDeg * Math.PI) / 180;
  const yaw = amp * Math.sin((TAU * t) / cfg.driftPeriod);
  const pitch = amp * 0.6 * Math.sin((TAU * t) / (cfg.driftPeriod * 1.23) + 1.3);
  if (shake <= 0) return { yaw, pitch, offsetX: 0, offsetY: 0 };
  const offsetX = shake * 0.02 * (0.6 * Math.sin(t * 41.0) + 0.4 * Math.sin(t * 67.3));
  const offsetY = shake * 0.02 * (0.6 * Math.sin(t * 53.1) + 0.4 * Math.sin(t * 29.7));
  return { yaw, pitch, offsetX, offsetY };
}

export function applyCamera(camera, pose, distance) {
  const { yaw, pitch, offsetX, offsetY } = pose;
  camera.position.set(
    distance * Math.sin(yaw) * Math.cos(pitch) + offsetX,
    distance * Math.sin(pitch) + offsetY,
    distance * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(offsetX * 0.5, offsetY * 0.5, 0);
}
