import { describe, it, expect } from 'vitest';
import { createRippleDriver, MAX_IMPULSES } from '../src/rippleDriver.js';
import { phaseCurves } from '../src/timeline.js';

const quiet = phaseCurves('charging', 0);
const noEnergy = { add: 0, sub: 0, mul: 0, div: 0 };
const snap = (litCount, energies = noEnergy) => ({ litCount, charge: litCount / 12, energies });

function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalForce(litCount, seconds = 10) {
  const d = createRippleDriver(seeded(42));
  let sum = 0;
  for (let k = 0; k < seconds * 60; k++) {
    for (const im of d.update(snap(litCount), quiet, 1 / 60)) sum += Math.abs(im.s);
  }
  return sum;
}

describe('createRippleDriver', () => {
  it('leaves the mercury still when no rune is lit', () => {
    const d = createRippleDriver(seeded(1));
    let count = 0;
    for (let k = 0; k < 600; k++) count += d.update(snap(0), phaseCurves('dormant', 0), 1 / 60).length;
    expect(count).toBe(0);
  });

  it('drives harder the more runes are lit', () => {
    const f3 = totalForce(3);
    const f6 = totalForce(6);
    const f11 = totalForce(11);
    expect(f3).toBeGreaterThan(0);
    expect(f6).toBeGreaterThan(f3 * 1.5);
    expect(f11).toBeGreaterThan(f6 * 1.5);
  });

  it('launches a ripple from the lit rune\'s rim position', () => {
    const d = createRippleDriver(seeded(1));
    d.ignite(11); // rune 12, top
    const out = d.update(snap(1), quiet, 1 / 60);
    const rim = out.find((im) => im.r === 0.08);
    expect(rim.x).toBeCloseTo(0, 5);
    expect(rim.y).toBeCloseTo(0.9, 5);
    expect(rim.s).toBeGreaterThan(0);
  });

  it('× energy echoes every ripple twice', () => {
    const d = createRippleDriver(seeded(1));
    const e = { ...noEnergy, mul: 1 };
    d.update(snap(1, e), quiet, 1 / 60);
    d.ignite(0);
    let rims = 0;
    for (let k = 0; k < 30; k++) rims += d.update(snap(1, e), quiet, 1 / 60).filter((im) => im.r === 0.08).length;
    expect(rims).toBe(3);
  });

  it('÷ energy adds four symmetric off-centre sources', () => {
    const d = createRippleDriver(seeded(1));
    const out = d.update(snap(6, { ...noEnergy, div: 1 }), quiet, 0.05);
    const at = (x, y) => out.some((im) => Math.abs(im.x - x) < 1e-9 && Math.abs(im.y - y) < 1e-9);
    expect(at(0.4, 0) && at(-0.4, 0) && at(0, 0.4) && at(0, -0.4)).toBe(true);
  });

  it('caps impulses per frame and delivers the backlog later', () => {
    const d = createRippleDriver(seeded(1));
    for (let k = 0; k < 40; k++) d.ignite(k % 12);
    let delivered = 0;
    for (let k = 0; k < 5; k++) {
      const out = d.update(snap(12), quiet, 1 / 60);
      expect(out.length).toBeLessThanOrEqual(MAX_IMPULSES);
      delivered += out.filter((im) => im.r === 0.08).length;
    }
    expect(delivered).toBe(40);
  });

  it('does not flood the sim after a huge dt', () => {
    const d = createRippleDriver(seeded(1));
    const out = d.update(snap(11), phaseCurves('collapsing', 0.5), 5);
    expect(out.length).toBeLessThanOrEqual(MAX_IMPULSES);
  });

  it('fires one big splash when the opening splash begins', () => {
    const d = createRippleDriver(seeded(1));
    const before = { ...quiet, splash: 0, open: 1 };
    const during = { ...quiet, splash: 0.5, open: 1 };
    d.update(snap(12), before, 1 / 60);
    const out = d.update(snap(12), during, 1 / 60);
    expect(out.filter((im) => im.r === 0.3)).toHaveLength(1);
    expect(d.update(snap(12), during, 1 / 60).filter((im) => im.r === 0.3)).toHaveLength(0);
  });
});
