import { describe, it, expect } from 'vitest';
import { updateHeat, emberLevel, runeGlow, chaseBoost, carveLevel } from '../src/runeLights.js';
import { openingCurves, phaseCurves } from '../src/timeline.js';

describe('heat / ember', () => {
  it('has no ember while the rune is lit', () => {
    let heat = 0;
    for (let p = 0; p <= 1; p += 0.1) {
      heat = updateHeat(heat, p, 1 / 60);
      expect(emberLevel(heat, p)).toBe(0);
    }
  });

  it('glows ember red after unlighting, then cools to dark', () => {
    let heat = 1;
    let p = 1;
    for (let k = 0; k < 54; k++) { p = Math.max(0, p - 1 / 54); heat = updateHeat(heat, p, 1 / 60); }
    expect(emberLevel(heat, p)).toBeGreaterThan(0.2);
    for (let k = 0; k < 600; k++) heat = updateHeat(heat, 0, 1 / 60);
    expect(emberLevel(heat, 0)).toBeLessThan(0.01);
  });
});

describe('runeGlow', () => {
  it('is dark when not lit and bounded when flaring', () => {
    expect(runeGlow(3, 12.3, 0, 1)).toBe(0);
    for (let t = 0; t < 30; t += 0.07) {
      const g = runeGlow(5, t, 1, 1);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });

  it('breathes out of phase between runes', () => {
    expect(runeGlow(0, 1, 1, 0)).not.toBeCloseTo(runeGlow(1, 1, 1, 0), 3);
  });
});

describe('chaseBoost', () => {
  it('is zero outside the chase', () => {
    expect(chaseBoost(4, phaseCurves('charging', 0))).toBe(0);
  });

  it('peaks at the chase head and is near zero opposite it', () => {
    const c = { ...openingCurves(0.5), chasePos: 0.25 }; // head at rune index 3
    expect(chaseBoost(3, c)).toBeGreaterThan(2);
    expect(chaseBoost(9, c)).toBeLessThan(0.01);
  });
});

describe('carveLevel', () => {
  it('is zero for a rune that was never lit (no glyph on the stone)', () => {
    expect(carveLevel(updateHeat(0, 0, 1 / 60))).toBe(0);
  });

  it('cuts in with the glow, lingers with the ember, then the stone is smooth again', () => {
    let heat = 0;
    let p = 0;
    for (let k = 0; k < 21; k++) { p = Math.min(1, p + 1 / 42); heat = updateHeat(heat, p, 1 / 60); }
    expect(carveLevel(heat)).toBeCloseTo(p, 5); // carving follows the glow as it lights
    for (let k = 0; k < 60; k++) { p = Math.min(1, p + 1 / 42); heat = updateHeat(heat, p, 1 / 60); }
    expect(carveLevel(heat)).toBe(1);
    for (let k = 0; k < 60; k++) { p = Math.max(0, p - 1 / 54); heat = updateHeat(heat, p, 1 / 60); }
    expect(carveLevel(heat)).toBeGreaterThan(0.3); // still carved while the ember cools
    for (let k = 0; k < 600; k++) heat = updateHeat(heat, 0, 1 / 60);
    expect(carveLevel(heat)).toBe(0); // gone after ~10 s
  });
});
