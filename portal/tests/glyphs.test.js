import { describe, it, expect } from 'vitest';
import { GLYPHS, MAX_SEGMENTS, flattenGlyph } from '../src/glyphs.js';

describe('GLYPHS', () => {
  it('has 12 distinct glyphs', () => {
    expect(GLYPHS).toHaveLength(12);
    expect(new Set(GLYPHS.map((g) => JSON.stringify(g))).size).toBe(12);
  });

  it('keeps every point inside the carving area', () => {
    for (const glyph of GLYPHS) {
      for (const stroke of glyph) {
        expect(stroke.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of stroke) {
          expect(Math.abs(x)).toBeLessThanOrEqual(0.45);
          expect(Math.abs(y)).toBeLessThanOrEqual(0.45);
        }
      }
    }
  });
});

describe('flattenGlyph', () => {
  it('fits the shader segment budget and parameterises strokes in pen order', () => {
    for (const glyph of GLYPHS) {
      const { segments, params } = flattenGlyph(glyph);
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.length).toBeLessThanOrEqual(MAX_SEGMENTS);
      expect(params[0][0]).toBe(0);
      for (let k = 1; k < params.length; k++) {
        expect(params[k][0]).toBeCloseTo(params[k - 1][0] + params[k - 1][1]);
      }
      const [lastStart, lastLen] = params[params.length - 1];
      expect(lastStart + lastLen).toBeCloseTo(1);
      for (const [, len] of params) expect(len).toBeGreaterThan(0);
    }
  });

  it('splits polylines into consecutive segments', () => {
    const { segments } = flattenGlyph([[[0, 0], [1, 0], [1, 1]]]);
    expect(segments).toEqual([[0, 0, 1, 0], [1, 0, 1, 1]]);
  });
});
