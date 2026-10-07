import { describe, it, expect } from 'vitest';
import {
  CURVE_KEYS, openingCurves, phaseCurves, followCurves,
  exposure, bloomStrength, EXPOSURE_CAP, BLOOM_CAP,
} from '../src/timeline.js';

const quiet = phaseCurves('dormant', 0);

describe('phaseCurves', () => {
  it('is all zero outside the opening/open/collapse phases', () => {
    for (const p of ['dormant', 'charging']) {
      const c = phaseCurves(p, 3);
      for (const k of CURVE_KEYS) expect(c[k]).toBe(0);
    }
  });

  it('follows the opening script', () => {
    expect(openingCurves(0.5).chase).toBeGreaterThan(0.9);
    expect(openingCurves(1.5).shake).toBeGreaterThan(0.9);
    expect(openingCurves(2.25).inhale).toBeGreaterThan(0.9);
    expect(openingCurves(2.75).surge).toBeGreaterThan(0.9);
    expect(openingCurves(3.5).splash).toBeGreaterThan(0.9);
    expect(openingCurves(5).open).toBe(1);
    expect(openingCurves(0.5).surge).toBe(0);
    expect(openingCurves(4.5).surge).toBe(0);
  });

  it('chases clockwise twice in the first second', () => {
    expect(openingCurves(0).chasePos).toBe(0);
    expect(openingCurves(0.5).chasePos).toBeCloseTo(1);
    expect(openingCurves(3).chasePos).toBe(2);
  });

  it('is fully open in the open phase', () => {
    expect(phaseCurves('open', 10).open).toBe(1);
    expect(phaseCurves('open', 10).surge).toBe(0);
  });

  it('flickers during collapse and is done after 2 s', () => {
    expect(phaseCurves('collapsing', 0.5).collapse).toBeGreaterThan(0.9);
    expect(phaseCurves('collapsing', 2).collapse).toBe(0);
    expect(phaseCurves('collapsing', 0.5).open).toBe(0);
  });
});

describe('followCurves', () => {
  it('eases a surge out instead of snapping when a rune is unlit mid-surge', () => {
    let c = followCurves(quiet, openingCurves(2.75), 10);
    expect(c.surge).toBeGreaterThan(0.9);
    const target = phaseCurves('collapsing', 0);
    c = followCurves(c, target, 1 / 60);
    expect(c.surge).toBeGreaterThan(0.8);
    for (let k = 0; k < 60; k++) c = followCurves(c, target, 1 / 60);
    expect(c.surge).toBeLessThan(0.01);
  });

  it('drains `open` slowly (about 2 s) during collapse', () => {
    let c = followCurves(quiet, phaseCurves('open', 0), 10);
    const target = phaseCurves('collapsing', 0);
    for (let k = 0; k < 30; k++) c = followCurves(c, target, 1 / 60);
    expect(c.open).toBeGreaterThan(0.3);
    for (let k = 0; k < 150; k++) c = followCurves(c, target, 1 / 60);
    expect(c.open).toBeLessThan(0.05);
  });

  it('copies chasePos directly (it wraps, so it must not be eased)', () => {
    const c = followCurves(quiet, openingCurves(0.5), 1 / 60);
    expect(c.chasePos).toBe(openingCurves(0.5).chasePos);
  });
});

describe('exposure & bloom', () => {
  it('brightens with charge', () => {
    expect(exposure(0.5, quiet)).toBeGreaterThan(exposure(0, quiet));
    expect(exposure(1, quiet)).toBeGreaterThan(exposure(0.5, quiet));
  });

  it('dips during the inhale', () => {
    expect(exposure(1, openingCurves(2.25))).toBeLessThan(exposure(1, quiet));
  });

  it('never exceeds the caps across the opening and open states', () => {
    for (let t = 0; t <= 6; t += 0.01) {
      const c = openingCurves(t);
      expect(exposure(1, c)).toBeLessThanOrEqual(EXPOSURE_CAP);
      expect(bloomStrength(1, c)).toBeLessThanOrEqual(BLOOM_CAP);
    }
    expect(exposure(1, phaseCurves('open', 0))).toBeLessThanOrEqual(EXPOSURE_CAP);
  });
});
