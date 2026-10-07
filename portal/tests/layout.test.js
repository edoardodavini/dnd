import { describe, it, expect } from 'vitest';
import { runeAngle, runeCenter, fitCameraDistance, renderPixelRatio } from '../src/layout.js';
import { CONFIG } from '../src/config.js';

describe('rune layout', () => {
  it('puts rune 12 at the top and the cardinals at 3/6/9 o\'clock', () => {
    const top = runeCenter(11, 1);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(1);
    expect(runeCenter(2, 1).x).toBeCloseTo(1);
    expect(runeCenter(2, 1).y).toBeCloseTo(0);
    expect(runeCenter(5, 1).y).toBeCloseTo(-1);
    expect(runeCenter(8, 1).x).toBeCloseTo(-1);
  });

  it('runs clockwise: rune 1 is at 1 o\'clock', () => {
    const c = runeCenter(0, 1);
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThan(c.x);
    expect(runeAngle(1)).toBeLessThan(runeAngle(0));
  });
});

describe('fitCameraDistance', () => {
  const tanHalf = Math.tan((CONFIG.camera.fov * Math.PI) / 360);
  const span = (2 * CONFIG.ring.outer) / CONFIG.camera.ringScreenFraction;

  it('makes the ring fill 85% of the height on a 16:9 screen', () => {
    const d = fitCameraDistance(16 / 9);
    expect(2 * d * tanHalf).toBeCloseTo(span);
  });

  it('keeps the whole ring visible on narrow / portrait windows', () => {
    for (const aspect of [1, 0.75, 0.5, 0.3]) {
      const d = fitCameraDistance(aspect);
      expect(2 * d * tanHalf * aspect).toBeGreaterThanOrEqual(span - 1e-9);
      expect(2 * d * tanHalf).toBeGreaterThanOrEqual(span - 1e-9);
    }
  });
});

describe('renderPixelRatio', () => {
  const cfg = { quality: { maxPixelRatio: 1.5, maxPixels: 6e6 } };

  it('uses the device ratio up to the cap on a 1080p-scaled TV', () => {
    expect(renderPixelRatio(1920, 1080, 2, cfg)).toBe(1.5);
    expect(renderPixelRatio(1920, 1080, 1, cfg)).toBe(1);
  });

  it('keeps a native-4K canvas under the pixel budget', () => {
    const r = renderPixelRatio(3840, 2160, 1, cfg);
    expect(3840 * r * 2160 * r).toBeLessThanOrEqual(6e6 + 1);
    expect(r).toBeGreaterThan(0.8);
  });
});
