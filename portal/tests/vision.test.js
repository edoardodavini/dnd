import { describe, it, expect } from 'vitest';
import { createVision, visionEnvelope } from '../src/vision.js';

const timing = { fadeIn: 1.5, hold: 2.5, fadeOut: 2.0 };

describe('visionEnvelope', () => {
  it('fades in, holds, then dissolves over ~6 s', () => {
    expect(visionEnvelope(0, timing)).toBe(0);
    expect(visionEnvelope(0.75, timing)).toBeGreaterThan(0.3);
    expect(visionEnvelope(0.75, timing)).toBeLessThan(0.7);
    expect(visionEnvelope(1.5, timing)).toBe(1);
    expect(visionEnvelope(3.9, timing)).toBe(1);
    expect(visionEnvelope(5, timing)).toBeLessThan(1);
    expect(visionEnvelope(6, timing)).toBe(0);
    expect(visionEnvelope(60, timing)).toBe(0);
  });
});

describe('createVision', () => {
  it('only shows the four energy runes', () => {
    const v = createVision(timing);
    expect(v.show(3)).toBe(false);
    expect(v.rune).toBeNull();
    for (const i of [2, 5, 8, 11]) {
      expect(v.show(i)).toBe(true);
      expect(v.rune).toBe(i);
    }
  });

  it('plays once, then clears itself', () => {
    const v = createVision(timing);
    v.show(5);
    expect(v.level).toBe(0);
    for (let k = 0; k < 120; k++) v.update(1 / 60);
    expect(v.level).toBe(1);
    for (let k = 0; k < 300; k++) v.update(1 / 60);
    expect(v.level).toBe(0);
    expect(v.rune).toBeNull();
  });

  it('replays from the start when summoned again', () => {
    const v = createVision(timing);
    v.show(2);
    v.update(3);
    v.show(8);
    expect(v.rune).toBe(8);
    expect(v.level).toBe(0);
  });

  it('survives a huge dt', () => {
    const v = createVision(timing);
    v.show(11);
    v.update(100);
    expect(v.rune).toBeNull();
    expect(v.level).toBe(0);
  });

  it('setInstant jumps to the fully visible hold (screenshots)', () => {
    const v = createVision(timing);
    v.setInstant(2);
    expect(v.rune).toBe(2);
    expect(v.level).toBe(1);
  });
});
