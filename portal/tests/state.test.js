import { describe, it, expect } from 'vitest';
import { createState, runeForKey, parseLitParam, RUNE_COUNT } from '../src/state.js';

const PHASES = ['dormant', 'charging', 'opening', 'open', 'collapsing'];
const lightAll = (s) => { for (let i = 0; i < RUNE_COUNT; i++) if (!s.lit[i]) s.toggle(i); };
const run = (s, seconds, step = 1 / 60) => { for (let k = 0; k < Math.round(seconds / step); k++) s.update(step); };

describe('runeForKey', () => {
  it('maps the number row to runes 0..11', () => {
    expect(runeForKey('Digit1')).toBe(0);
    expect(runeForKey('Digit9')).toBe(8);
    expect(runeForKey('Digit0')).toBe(9);
    expect(runeForKey('Minus')).toBe(10);
    expect(runeForKey('Equal')).toBe(11);
    expect(runeForKey('KeyA')).toBeUndefined();
  });
});

describe('parseLitParam', () => {
  it('parses 1-based lists, "all", and rejects junk', () => {
    expect(parseLitParam('1,2,12')).toEqual([0, 1, 11]);
    expect(parseLitParam('all')).toEqual([...Array(12).keys()]);
    expect(parseLitParam('0,13,x,3')).toEqual([2]);
    expect(parseLitParam('')).toBeNull();
    expect(parseLitParam(null)).toBeNull();
  });
});

describe('createState', () => {
  it('starts dormant with nothing lit', () => {
    const s = createState();
    expect(s.phase).toBe('dormant');
    expect(s.litCount).toBe(0);
    expect(s.charge).toBe(0);
  });

  it('toggles runes and moves dormant -> charging -> dormant', () => {
    const s = createState();
    s.toggle(3);
    expect(s.lit[3]).toBe(true);
    expect(s.phase).toBe('charging');
    s.toggle(3);
    expect(s.lit[3]).toBe(false);
    expect(s.phase).toBe('dormant');
  });

  it('ignores out-of-range toggles', () => {
    const s = createState();
    s.toggle(-1); s.toggle(12); s.toggle(1.5);
    expect(s.litCount).toBe(0);
  });

  it('opens when all 12 are lit, becoming open after 5 s', () => {
    const s = createState();
    lightAll(s);
    expect(s.phase).toBe('opening');
    run(s, 4.9);
    expect(s.phase).toBe('opening');
    run(s, 0.2);
    expect(s.phase).toBe('open');
  });

  it('collapses when a rune is unlit while open, then returns to charging', () => {
    const s = createState();
    lightAll(s);
    run(s, 5.1);
    s.toggle(4);
    expect(s.phase).toBe('collapsing');
    expect(s.phaseTime).toBe(0);
    run(s, 2.1);
    expect(s.phase).toBe('charging');
  });

  it('collapses when a rune is unlit mid-opening', () => {
    const s = createState();
    lightAll(s);
    run(s, 2.4);
    s.toggle(0);
    expect(s.phase).toBe('collapsing');
  });

  it('restarts opening from t=0 if the missing rune is re-lit during collapse', () => {
    const s = createState();
    lightAll(s);
    run(s, 5.1);
    s.toggle(7);
    run(s, 1);
    s.toggle(7);
    expect(s.phase).toBe('opening');
    expect(s.phaseTime).toBe(0);
  });

  it('reset from charging goes straight to dormant', () => {
    const s = createState();
    s.toggle(0); s.toggle(1);
    s.reset();
    expect(s.litCount).toBe(0);
    expect(s.phase).toBe('dormant');
  });

  it('reset from open plays the collapse, then dormant', () => {
    const s = createState();
    lightAll(s);
    run(s, 5.1);
    s.reset();
    expect(s.phase).toBe('collapsing');
    run(s, 2.1);
    expect(s.phase).toBe('dormant');
  });

  it('animates progress linearly and reverses from the current value', () => {
    const s = createState();
    s.toggle(0);
    run(s, 0.35, 0.05);
    expect(s.progress[0]).toBeCloseTo(0.5, 1);
    s.toggle(0);
    s.update(0.09);
    expect(s.progress[0]).toBeCloseTo(0.4, 1);
    run(s, 1);
    expect(s.progress[0]).toBe(0);
  });

  it('eases charge toward litCount/12 monotonically', () => {
    const s = createState();
    for (let i = 0; i < 6; i++) s.toggle(i);
    let prev = 0;
    for (let k = 0; k < 180; k++) {
      s.update(1 / 60);
      expect(s.charge).toBeGreaterThanOrEqual(prev);
      prev = s.charge;
    }
    expect(s.charge).toBeCloseTo(0.5, 2);
  });

  it('charge targets 1 while opening/open', () => {
    const s = createState();
    lightAll(s);
    run(s, 6);
    expect(s.charge).toBeCloseTo(1, 2);
  });

  it('eases energy levels for the cardinal runes only', () => {
    const s = createState();
    s.toggle(2);
    run(s, 4);
    expect(s.energies.add).toBeGreaterThan(0.99);
    expect(s.energies.sub).toBe(0);
    expect(s.energies.mul).toBe(0);
    expect(s.energies.div).toBe(0);
  });

  it('emits ignite/unlight/phase events', () => {
    const s = createState();
    const log = [];
    s.onIgnite((i) => log.push(`ignite ${i}`));
    s.onUnlight((i) => log.push(`unlight ${i}`));
    s.onPhase((p) => log.push(`phase ${p}`));
    s.toggle(5);
    s.toggle(5);
    expect(log).toEqual(['ignite 5', 'phase charging', 'unlight 5', 'phase dormant']);
  });

  it('survives key mashing with valid progress and phase', () => {
    const s = createState();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2000; k++) {
      if (rand() < 0.4) s.toggle(Math.floor(rand() * 12));
      if (rand() < 0.02) s.reset();
      s.update(rand() * 0.05);
      for (const p of s.progress) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(PHASES).toContain(s.phase);
      expect(s.charge).toBeGreaterThanOrEqual(0);
      expect(s.charge).toBeLessThanOrEqual(1);
    }
  });

  it('handles a huge dt (tab was hidden) without invalid values', () => {
    const s = createState();
    lightAll(s);
    s.update(10);
    expect(s.phase).toBe('open');
    expect(s.progress.every((p) => p === 1)).toBe(true);
    expect(s.charge).toBeLessThanOrEqual(1);
    expect(Number.isFinite(s.charge)).toBe(true);
  });

  it('setInstant jumps straight to a settled state', () => {
    const s = createState();
    s.setInstant([0, 1, 2]);
    expect(s.phase).toBe('charging');
    expect(s.progress.slice(0, 4)).toEqual([1, 1, 1, 0]);
    expect(s.charge).toBeCloseTo(0.25);
    expect(s.energies.add).toBe(1);
    s.setInstant([...Array(12).keys()]);
    expect(s.phase).toBe('open');
    expect(s.charge).toBe(1);
  });
});
