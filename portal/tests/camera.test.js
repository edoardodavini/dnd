import { describe, it, expect } from 'vitest';
import { cameraPose } from '../src/camera.js';

describe('cameraPose', () => {
  it('drifts within ±2 degrees', () => {
    const limit = (2 * Math.PI) / 180 + 1e-9;
    for (let t = 0; t < 120; t += 0.25) {
      const p = cameraPose(t, 0);
      expect(Math.abs(p.yaw)).toBeLessThanOrEqual(limit);
      expect(Math.abs(p.pitch)).toBeLessThanOrEqual(limit);
    }
  });

  it('only shakes when asked, and only a little', () => {
    for (let t = 0; t < 10; t += 0.1) {
      const calm = cameraPose(t, 0);
      expect(calm.offsetX).toBe(0);
      expect(calm.offsetY).toBe(0);
      const shaken = cameraPose(t, 1);
      expect(Math.abs(shaken.offsetX)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(shaken.offsetY)).toBeLessThanOrEqual(0.02);
    }
  });
});
