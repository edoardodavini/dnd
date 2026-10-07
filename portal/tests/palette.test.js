import { describe, it, expect } from 'vitest';
import { glowColor } from '../src/palette.js';

describe('glowColor', () => {
  it('is deep amber for 1-3 runes', () => {
    for (const n of [0, 1, 2]) expect(glowColor(n / 12)).toEqual([1.0, 0.42, 0.08]);
  });

  it('hits the band colours at their centres', () => {
    expect(glowColor(5 / 12)).toEqual([1.0, 0.68, 0.22]);
    expect(glowColor(8 / 12)).toEqual([1.0, 0.88, 0.62]);
    expect(glowColor(1)).toEqual([0.6, 0.82, 1.0]);
  });

  it('cools monotonically: blue never drops, red never rises', () => {
    let prev = glowColor(0);
    for (let c = 0; c <= 1.0001; c += 0.01) {
      const cur = glowColor(c);
      expect(cur[2]).toBeGreaterThanOrEqual(prev[2] - 1e-9);
      expect(cur[0]).toBeLessThanOrEqual(prev[0] + 1e-9);
      prev = cur;
    }
  });

  it('clamps out-of-range input', () => {
    expect(glowColor(-1)).toEqual(glowColor(0));
    expect(glowColor(2)).toEqual(glowColor(1));
  });
});
