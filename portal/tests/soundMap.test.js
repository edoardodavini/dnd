import { describe, it, expect } from 'vitest';
import {
  soundParams, bowlFrequency, dbToGain, createVolume, cuesCrossed, dropletsDue,
} from '../src/soundMap.js';
import { phaseCurves, openingCurves } from '../src/timeline.js';

const NONE = { add: 0, sub: 0, mul: 0, div: 0 };
const quiet = phaseCurves('charging', 0);
const at = (charge, energies = NONE, curves = quiet, vision = 0) => soundParams({ charge, energies }, curves, vision);

describe('soundParams', () => {
  it('is silent except for the air when nothing is lit', () => {
    const p = at(0);
    expect(p.air).toBeGreaterThan(0);
    for (const k of ['drone', 'liquid', 'liquidRate', 'choir', 'add', 'sub', 'echo', 'beat']) expect(p[k]).toBe(0);
  });

  it('never lowers drone loudness or brightness as runes light', () => {
    let prev = at(0);
    for (let c = 0.01; c <= 1.0001; c += 0.01) {
      const p = at(c);
      expect(p.drone).toBeGreaterThanOrEqual(prev.drone);
      expect(p.droneCutoff).toBeGreaterThanOrEqual(prev.droneCutoff);
      prev = p;
    }
  });

  it('lets the air fade as the portal wakes', () => {
    expect(at(0.5).air).toBe(0);
  });

  it('colours the sound only for lit energy runes', () => {
    expect(at(0.5, { ...NONE, add: 1 }).add).toBeGreaterThan(0);
    expect(at(0.5, { ...NONE, sub: 1 }).sub).toBeGreaterThan(0);
    expect(at(0.5, { ...NONE, mul: 1 }).echo).toBeGreaterThan(0);
    expect(at(0.5, { ...NONE, div: 1 }).beat).toBeGreaterThan(0);
    const p = at(0.5, { ...NONE, add: 1 });
    expect([p.sub, p.echo, p.beat]).toEqual([0, 0, 0]);
  });

  it('quiets the liquid by at least 85% while a vision shows', () => {
    expect(at(0.5, NONE, quiet, 1).liquid).toBeLessThanOrEqual(0.15 * at(0.5).liquid);
  });

  it('ducks the drone on the inhale', () => {
    expect(at(1, NONE, openingCurves(2.25)).drone).toBeLessThan(0.2 * at(1).drone);
  });

  it('sags and flutters the drone while collapsing', () => {
    const p = at(0.5, NONE, phaseCurves('collapsing', 0.5));
    expect(p.dronePitch).toBeLessThan(1);
    expect(p.flutter).toBeGreaterThan(0.9);
  });

  it('brings in the choir when open', () => {
    const p = at(1, NONE, phaseCurves('open', 0));
    expect(p.choir).toBeCloseTo(0.45);
    expect(p.air).toBe(0);
  });
});

describe('bowlFrequency', () => {
  it('walks A minor pentatonic up from A3', () => {
    const f = [...Array(12).keys()].map(bowlFrequency);
    expect(f[0]).toBeCloseTo(220);
    expect(f[1]).toBeCloseTo(261.63, 1);
    expect(f[5]).toBeCloseTo(440);
    expect(f[11]).toBeCloseTo(1046.5, 0);
    for (let k = 1; k < 12; k++) expect(f[k]).toBeGreaterThan(f[k - 1]);
  });
});

describe('createVolume', () => {
  it('starts at -12 dB', () => {
    const v = createVolume();
    expect(v.gain).toBeCloseTo(dbToGain(-12));
    expect(v.label).toBe('vol -12 dB');
  });

  it('mutes and unmutes', () => {
    const v = createVolume();
    v.toggleMute();
    expect(v.gain).toBe(0);
    expect(v.label).toBe('muted');
    v.toggleMute();
    expect(v.gain).toBeCloseTo(dbToGain(-12));
  });

  it('steps by 3 dB within -36..0 dB', () => {
    const v = createVolume();
    v.step(1);
    expect(v.label).toBe('vol -9 dB');
    for (let k = 0; k < 20; k++) v.step(1);
    expect(v.label).toBe('vol 0 dB');
    for (let k = 0; k < 40; k++) v.step(-1);
    expect(v.label).toBe('vol -36 dB');
  });

  it('unmutes when the volume is changed', () => {
    const v = createVolume();
    v.toggleMute();
    v.step(1);
    expect(v.label).toBe('vol -9 dB');
    expect(v.gain).toBeGreaterThan(0);
  });
});

describe('cuesCrossed', () => {
  it('reports each opening cue exactly once as time passes it', () => {
    expect(cuesCrossed(0.9, 1.1)).toEqual(['rumble']);
    expect(cuesCrossed(1.0, 1.5)).toEqual([]);
    expect(cuesCrossed(0, 5)).toEqual(['rumble', 'inhale', 'surge', 'splash']);
  });
});

describe('dropletsDue', () => {
  it('accumulates fractional droplets', () => {
    let s = { clock: 0 };
    let total = 0;
    for (let k = 0; k < 8; k++) {
      s = dropletsDue(s.clock, 0.25, 2);
      total += s.count;
    }
    expect(total).toBe(4);
  });

  it('never bursts after a long frame', () => {
    const s = dropletsDue(0, 10, 8.5);
    expect(s.count).toBe(3);
    expect(s.clock).toBeLessThanOrEqual(1);
  });

  it('is silent at rate 0', () => {
    expect(dropletsDue(0.5, 1, 0)).toEqual({ count: 0, clock: 0.5 });
  });
});
